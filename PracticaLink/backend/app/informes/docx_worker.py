"""Conservative DOCX Transitional profile. Bytes are inspected, never rewritten."""
import io
import posixpath
import re
import stat
import struct
import sys
import unicodedata
from urllib.parse import unquote, urlsplit
import zipfile

MAX_BYTES = 10 * 1024 * 1024
MAX_ENTRIES = 2048
MAX_TOTAL = 64 * 1024 * 1024
MAX_ENTRY = 16 * 1024 * 1024
MAX_XML = 8 * 1024 * 1024
MAX_DEPTH = 128
MAX_NODES = 500000
MAX_IMAGE_PIXELS = 20000000
MAX_TOTAL_PIXELS = 80000000
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
P = 'http://schemas.openxmlformats.org/package/2006/relationships'
C = 'http://schemas.openxmlformats.org/package/2006/content-types'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
MAIN = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'
REL = 'application/vnd.openxmlformats-package.relationships+xml'
WORD_TYPES = {kind: 'application/vnd.openxmlformats-officedocument.wordprocessingml.' + suffix + '+xml'
              for kind, suffix in [('styles', 'styles'), ('settings', 'settings'),
                 ('numbering', 'numbering'), ('fontTable', 'fontTable'), ('header', 'header'),
                 ('footer', 'footer'), ('footnotes', 'footnotes'), ('endnotes', 'endnotes'),
                 ('comments', 'comments'), ('webSettings', 'webSettings')]}
ROOTS = {MAIN: W + '}document', **{v: W + '}' + {'header': 'hdr', 'footer': 'ftr', 'fontTable': 'fonts'}.get(k, k) for k, v in WORD_TYPES.items()},
         'application/vnd.openxmlformats-officedocument.theme+xml': A + '}theme',
         'application/vnd.openxmlformats-package.core-properties+xml': 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties}coreProperties',
         'application/vnd.openxmlformats-officedocument.extended-properties+xml': 'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties}Properties',
         'application/vnd.openxmlformats-officedocument.custom-properties+xml': 'http://schemas.openxmlformats.org/officeDocument/2006/custom-properties}Properties'}
ROOTS = {key: '{' + value for key, value in ROOTS.items()}
NAMESPACES = {W, R, A, P, C,
    'http://schemas.openxmlformats.org/markup-compatibility/2006',
    'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
    'http://schemas.openxmlformats.org/drawingml/2006/picture',
    'http://schemas.openxmlformats.org/package/2006/metadata/core-properties',
    'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties',
    'http://schemas.openxmlformats.org/officeDocument/2006/custom-properties',
    'http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes',
    'http://purl.org/dc/elements/1.1/', 'http://purl.org/dc/terms/',
    'http://www.w3.org/2001/XMLSchema-instance', 'http://www.w3.org/XML/1998/namespace',
    'urn:schemas-microsoft-com:vml', 'urn:schemas-microsoft-com:office:office',
    'urn:schemas-microsoft-com:office:word',
    'http://schemas.microsoft.com/office/word/2010/wordml',
    'http://schemas.microsoft.com/office/word/2012/wordml',
    'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
    'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup',
    'http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas'}
REL_TYPES = {R + '/' + key: {value} for key, value in WORD_TYPES.items()}
REL_TYPES.update({R + '/officeDocument': {MAIN}, R + '/image': {'image/png', 'image/jpeg'},
 R + '/theme': {'application/vnd.openxmlformats-officedocument.theme+xml'},
 P + '/metadata/core-properties': {'application/vnd.openxmlformats-package.core-properties+xml'},
 R + '/extended-properties': {'application/vnd.openxmlformats-officedocument.extended-properties+xml'},
 R + '/custom-properties': {'application/vnd.openxmlformats-officedocument.custom-properties+xml'}})
HYPERLINK = R + '/hyperlink'


def require(value):
    if not value:
        raise ValueError('DOCX profile violation')


def safe_name(name):
    require(name and name == unicodedata.normalize('NFC', name) and len(name) <= 255)
    require(not name.startswith('/') and '\\' not in name and '%' not in name and ':' not in name)
    require(all(ord(c) >= 32 and ord(c) != 127 for c in name))
    require(all(part not in ('', '.', '..') and part.strip() == part for part in name.split('/')))
    return name


def package(data):
    require(0 < len(data) <= MAX_BYTES and data.startswith(b'PK\x03\x04'))
    end = data.rfind(b'PK\x05\x06')
    require(end >= 0 and end + 22 <= len(data))
    _, disk, central_disk, disk_count, count, central_size, central, comment = struct.unpack_from('<4s4H2IH', data, end)
    require(disk == central_disk == 0 and disk_count == count and 0 < count <= MAX_ENTRIES)
    require(count != 65535 and central != 0xffffffff and central + central_size == end)
    require(end + 22 + comment == len(data))
    files = {}; aliases = set(); total = 0; cursor = 0
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        infos = archive.infolist()
        require(len(infos) == count and archive.start_dir == central)
        for info in sorted(infos, key=lambda item: item.header_offset):
            original = info.orig_filename
            require(original == info.filename)
            name = safe_name(original.rstrip('/') if info.is_dir() else original)
            require(name.casefold() not in aliases); aliases.add(name.casefold())
            require(info.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED))
            require(not info.flag_bits & ~(0x800 | 0x8 | 0x6))
            mode = info.external_attr >> 16
            require(not stat.S_ISLNK(mode) and stat.S_IFMT(mode) in (0, stat.S_IFREG, stat.S_IFDIR))
            require(info.file_size <= MAX_ENTRY and total + info.file_size <= MAX_TOTAL)
            extra = info.extra
            while extra:
                require(len(extra) >= 4)
                kind, size = struct.unpack_from('<HH', extra)
                require(kind != 1 and size <= len(extra) - 4); extra = extra[4 + size:]
            require(info.header_offset == cursor and cursor + 30 <= central)
            fields = struct.unpack_from('<4s5H3I2H', data, cursor)
            signature, _, flags, method, _, _, crc, compressed, expanded, name_len, extra_len = fields
            require(signature == b'PK\x03\x04' and flags == info.flag_bits and method == info.compress_type)
            start = cursor + 30 + name_len + extra_len
            require(start + info.compress_size <= central)
            local_extra = data[cursor + 30 + name_len:start]
            while local_extra:
                require(len(local_extra) >= 4)
                kind, size = struct.unpack_from('<HH', local_extra)
                require(kind != 1 and size <= len(local_extra) - 4)
                local_extra = local_extra[4 + size:]
            encoded = data[cursor + 30:cursor + 30 + name_len]
            require(encoded.decode('utf-8' if flags & 0x800 else 'cp437') == original)
            if not flags & 8:
                require((crc, compressed, expanded) == (info.CRC, info.compress_size, info.file_size))
            else:
                require(crc in (0, info.CRC) and compressed in (0, info.compress_size) and expanded in (0, info.file_size))
            cursor = start + info.compress_size
            if flags & 8:
                if data[cursor:cursor + 4] == b'PK\x07\x08': cursor += 4
                require(cursor + 12 <= central)
                require(struct.unpack_from('<III', data, cursor) == (info.CRC, info.compress_size, info.file_size)); cursor += 12
            content = bytearray()
            with archive.open(info) as stream:
                while block := stream.read(65536):
                    content.extend(block); total += len(block)
                    require(len(content) <= MAX_ENTRY and total <= MAX_TOTAL)
            require(len(content) == info.file_size)
            if info.is_dir(): require(not content)
            else: files[name] = bytes(content)
        require(cursor == central)
    return files


def xml(raw, budget):
    from defusedxml import ElementTree
    require(len(raw) <= MAX_XML)
    depth = 0; root = None
    for event, element in ElementTree.iterparse(io.BytesIO(raw), events=('start', 'end', 'pi'),
                       forbid_dtd=True, forbid_entities=True, forbid_external=True):
        require(event != 'pi')
        if event == 'start':
            depth += 1; budget[0] += 1
            require(depth <= MAX_DEPTH and budget[0] <= MAX_NODES and len(element.attrib) <= 64)
            if root is None: root = element
            for tag in [element.tag, *element.attrib]:
                if tag.startswith('{'): require(tag[1:].split('}', 1)[0] in NAMESPACES)
        else: depth -= 1
    require(root is not None and depth == 0)
    return root


def hyperlink(target):
    require(target and len(target) <= 4096 and '\\' not in target)
    require(not any(c.isspace() or ord(c) < 32 or ord(c) == 127 for c in target))
    parsed = urlsplit(target)
    require(parsed.scheme.lower() in ('http', 'https', 'mailto'))
    if parsed.scheme.lower() == 'mailto':
        require(parsed.path and not parsed.netloc and not parsed.path.startswith('//'))
    else:
        require(parsed.hostname and not parsed.username and not parsed.password)
        _ = parsed.port  # Reject malformed ports; never resolves a hostname.


def target_part(source, target):
    require(target and '\\' not in target and not target.startswith('//'))
    require(not any(ord(c) < 32 or ord(c) == 127 for c in target))
    require(not re.search(r'%(?:2f|5c|00)', target, re.I))
    uri = urlsplit(target)
    require(not uri.scheme and not uri.netloc and not uri.query and not uri.fragment)
    decoded = unquote(uri.path, errors='strict')
    path = posixpath.normpath(decoded.lstrip('/') if decoded.startswith('/') else posixpath.join(posixpath.dirname(source), decoded))
    return safe_name(path)


def field(instruction):
    require(len(instruction) <= 8192)
    text = instruction.strip()
    command = text.split(None, 1)[0].upper() if text else ''
    if command == 'HYPERLINK':
        match = re.fullmatch(r'HYPERLINK\s+(?:"([^"\r\n]+)"|([^\s"\\]+))\s*', text, re.I)
        require(match is not None); hyperlink(match.group(1) or match.group(2))
    else:
        require(command in {'PAGE', 'NUMPAGES', 'REF', 'PAGEREF'})
        # Only bookmark/page fields and inert formatting switches, never nested code.
        require(re.fullmatch(r'[A-Za-z0-9_\s\\*".\-]+', text) is not None)


def word_content(tree, relations):
    stack = []
    for element in tree.iter():
        local = element.tag.split('}')[-1]
        require(local not in {'altChunk', 'object', 'OLEObject', 'control', 'subDoc',
                             'attachedTemplate', 'dataBinding', 'externalData', 'binData',
                             'script', 'scriptCode', 'scriptProject', 'vbaProject'})
        for key, value in element.attrib.items():
            require(key not in ('{http://www.w3.org/2001/XMLSchema-instance}schemaLocation',
                                '{http://www.w3.org/2001/XMLSchema-instance}noNamespaceSchemaLocation'))
            if key.startswith('{' + R + '}'):
                require(value in relations)
                kind, target, external = relations[value]
                if key.split('}')[-1] in ('embed', 'link'):
                    require(kind == R + '/image' and not external)
                if external:
                    require(kind == HYPERLINK and element.tag in ('{' + W + '}hyperlink', '{' + A + '}hlinkClick'))
            elif key == '{urn:schemas-microsoft-com:office:office}relid':
                require(value in relations and relations[value][0] == R + '/image' and not relations[value][2])
            elif key.split('}')[-1].lower() in ('src', 'href'):
                require(not value)  # VML/XLink must not bypass the relationship graph.
        if element.tag == '{' + W + '}fldSimple': field(element.get('{' + W + '}instr', ''))
        if element.tag == '{' + W + '}fldChar':
            kind = element.get('{' + W + '}fldCharType')
            if kind == 'begin':
                require(not stack); stack.append(['', False])
            elif kind == 'separate':
                require(stack and not stack[-1][1]); field(stack[-1][0]); stack[-1][1] = True
            elif kind == 'end':
                require(stack)
                if not stack[-1][1]: field(stack[-1][0])
                stack.pop()
            else: require(False)
        if element.tag in ('{' + W + '}instrText', '{' + W + '}delInstrText'):
            require(stack and not stack[-1][1])
            stack[-1][0] += element.text or ''; require(len(stack[-1][0]) <= 8192)
        if local == 'HyperlinkBase': require(not (element.text or '').strip())
    require(not stack)


def image(raw, content_type, pixels):
    import warnings
    from PIL import Image, ImageFile
    Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS
    ImageFile.LOAD_TRUNCATED_IMAGES = False
    with warnings.catch_warnings():
        warnings.simplefilter('error', Image.DecompressionBombWarning)
        for verify_only in (True, False):
            with Image.open(io.BytesIO(raw), formats=('PNG', 'JPEG')) as item:
                require(item.format == ('PNG' if content_type == 'image/png' else 'JPEG'))
                require(0 < item.width <= 20000 and 0 < item.height <= 20000)
                require(item.width * item.height <= MAX_IMAGE_PIXELS and getattr(item, 'n_frames', 1) == 1)
                if verify_only:
                    pixels[0] += item.width * item.height; require(pixels[0] <= MAX_TOTAL_PIXELS)
                    item.verify()
                else: item.load()
    require(raw.endswith(b'\x00\x00\x00\x00IEND\xaeB`\x82') if content_type == 'image/png' else raw.endswith(b'\xff\xd9'))


def validate(data):
    files = package(data); budget = [0]; pixels = [0]
    require('[Content_Types].xml' in files and '_rels/.rels' in files)
    types = xml(files['[Content_Types].xml'], budget)
    require(types.tag == '{' + C + '}Types')
    defaults = {}; overrides = {}
    for item in types:
        if item.tag == '{' + C + '}Default':
            key = item.get('Extension', '').lower(); require(key and key not in defaults and '/' not in key)
            defaults[key] = item.get('ContentType')
        elif item.tag == '{' + C + '}Override':
            key = item.get('PartName', ''); require(key.startswith('/') and not key.startswith('//'))
            key = safe_name(key[1:]); require(key in files and key not in overrides)
            overrides[key] = item.get('ContentType')
        else: require(False)
    content_types = {}; trees = {}
    allowed = set(ROOTS) | {REL, 'image/png', 'image/jpeg'}
    for name, raw in files.items():
        if name == '[Content_Types].xml': continue
        ct = overrides.get(name, defaults.get(name.rsplit('.', 1)[-1].lower()))
        require(ct in allowed); content_types[name] = ct
        if ct in ('image/png', 'image/jpeg'): image(raw, ct, pixels)
        else:
            tree = xml(raw, budget); trees[name] = tree
            require(tree.tag == ('{' + P + '}Relationships' if ct == REL else ROOTS[ct]))
            require((ct == REL) == name.endswith('.rels'))
    relations = {}; edges = {}; main = []
    for name, tree in trees.items():
        if content_types[name] != REL: continue
        if name == '_rels/.rels': source = ''
        else:
            parent, base = posixpath.split(name)
            require(parent.endswith('/_rels'))
            source = posixpath.join(parent[:-6], base[:-5]); require(source in files)
        require(source not in relations); relations[source] = {}; edges[source] = []
        for entry in tree:
            require(entry.tag == '{' + P + '}Relationship')
            require(set(entry.attrib) <= {'Id', 'Type', 'Target', 'TargetMode'})
            rid, kind, target = entry.get('Id'), entry.get('Type'), entry.get('Target', '')
            require(rid and rid not in relations[source])
            mode = entry.get('TargetMode', 'Internal'); require(mode in ('Internal', 'External'))
            if mode == 'External':
                require(kind == HYPERLINK and source and content_types[source] in ROOTS)
                hyperlink(target)
            else:
                require(kind in REL_TYPES)
                target = target_part(source, target)
                require(target in content_types and content_types[target] in REL_TYPES[kind])
                if kind == R + '/officeDocument': require(not source); main.append(target)
                edges[source].append(target)
            relations[source][rid] = (kind, target, mode == 'External')
    require(len(main) == 1 and len(trees[main[0]].findall('{' + W + '}body')) == 1)
    visited = set(); pending = ['']
    while pending:
        current = pending.pop()
        if current in visited: continue
        visited.add(current); pending.extend(edges.get(current, []))
    require(all(name in visited for name, ct in content_types.items() if ct != REL))
    require(all(not source or source in visited for source in relations))
    for name, tree in trees.items():
        if content_types[name] != REL: word_content(tree, relations.get(name, {}))


def main():
    import resource
    try:
        resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024,) * 2)
        resource.setrlimit(resource.RLIMIT_CPU, (5, 5))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        resource.setrlimit(resource.RLIMIT_FSIZE, (0, 0))
        sys.path.insert(0, '/deps')
        import defusedxml  # noqa: F401
        from PIL import Image  # noqa: F401
    except Exception:
        return 3
    print('READY', flush=True)
    try:
        validate(sys.stdin.buffer.read(MAX_BYTES + 1))
    except Exception:
        print('DOCX_REJECT', flush=True); return 2
    print('DOCX_OK', flush=True); return 0


if __name__ == '__main__':
    sys.exit(main())
