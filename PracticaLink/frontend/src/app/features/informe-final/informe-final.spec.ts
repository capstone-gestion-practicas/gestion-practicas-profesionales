import { ConsultaAcademica, Evaluacion, EvaluacionService } from '../evaluaciones/evaluacion.service';
import { TestBed, ComponentFixture, fakeAsync, tick } from '@angular/core/testing';
import { HttpErrorResponse, HttpEvent, HttpEventType, HttpResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { Subject, of, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { InformeFinal } from './informe-final';
import { EntregaInforme, Informe, InformeService, FORMATOS_INFORME } from './informe.service';

const actual: Informe = { id_practica: 7, estado: 'ENTREGADO', version: 1, id_documento: 9,
  formato: 'PDF', mime_type: 'application/pdf', nombre: 'informe.pdf', tamano: 20, fecha: '2026-11-08', habilitada: true, fecha_habilitada: '2026-11-07' };

const entregada: EntregaInforme = { id_entrega: 'uuid', id_documento: 9, version: 2, fecha: '2026-11-09', estado: 'ENTREGADO', formato: 'PDF', mime_type: 'application/pdf' };

describe('Informe final: sección académica', () => {
  let fixture: ComponentFixture<InformeFinal>;
  let api: jasmine.SpyObj<InformeService>;
  let academico: jasmine.SpyObj<EvaluacionService>;
  const estado: ConsultaAcademica = { id_practica: 7, id_documento: 9, version: 1, estado_informe: 'ENTREGADO', evaluacion_pendiente: null, resultado_vigente: null, historial: [] };
  beforeEach(async () => {
    api = jasmine.createSpyObj<InformeService>('InformeService', ['consultar', 'entregar', 'descargar']);
    api.consultar.and.returnValue(of(actual));
    academico = jasmine.createSpyObj<EvaluacionService>('EvaluacionService', ['consultar']);
    academico.consultar.and.returnValue(of(estado));
    await TestBed.configureTestingModule({ imports: [InformeFinal], providers: [{ provide: InformeService, useValue: api }, { provide: EvaluacionService, useValue: academico }] }).compileComponents();
    fixture = TestBed.createComponent(InformeFinal);
    fixture.componentRef.setInput('idPractica', 7); fixture.componentRef.setInput('estudiante', true);
    fixture.detectChanges();
  });
  afterEach(() => fixture.destroy());
  it('consulta disponibilidad y versión vigente con carga controlada', () => {
    const pending = new Subject<Informe>(); api.consultar.and.returnValue(pending);
    fixture.componentInstance.cargar(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Consultando informe');
    pending.next(actual); pending.complete(); fixture.detectChanges();
    expect(api.consultar).toHaveBeenCalledOnceWith(7);
    expect(fixture.nativeElement.textContent).toContain('Versión: 1');
    expect(fixture.nativeElement.textContent).toContain('Reemplazar informe');
  });
  it('muestra SIN_ENTREGAR y fecha sin ofrecer reemplazo si no está habilitado', () => {
    api.consultar.and.returnValue(of({ ...actual, estado: 'SIN_ENTREGAR', version: 0, id_documento: null, formato: null, mime_type: null, nombre: null, habilitada: false }));
    fixture.componentInstance.cargar(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('SIN_ENTREGAR');
    expect(fixture.nativeElement.textContent).toContain('2026-11-07');
    expect(fixture.nativeElement.querySelector('input[type=file]')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Descargar informe vigente');
  });
  it('las vistas de consulta no ofrecen controles de entrega', () => {
    fixture.componentRef.setInput('estudiante', false); fixture.detectChanges();
    fixture.componentInstance.cargar(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Descargar informe vigente');
    expect(fixture.nativeElement.querySelector('input[type=file]')).toBeNull();
    fixture.componentInstance.archivo = new File(['x'], 'informe.pdf'); fixture.componentInstance.entregar();
    expect(api.entregar).not.toHaveBeenCalled();
  });
  it('mantiene clave y versión en reintentos; bloquea doble envío y refresca tras confirmar', () => {
    const panel = fixture.componentInstance; panel.cargar(); fixture.detectChanges();
    panel.archivo = new File(['synthetic'], 'informe.pdf', { type: 'application/pdf' });
    api.entregar.and.returnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    panel.entregar(); const first = api.entregar.calls.mostRecent().args;
    const pending = new Subject<HttpEvent<EntregaInforme>>(); api.entregar.and.returnValue(pending);
    panel.entregar(); panel.entregar();
    expect(api.entregar).toHaveBeenCalledTimes(2);
    expect(api.entregar.calls.mostRecent().args).toEqual(first);
    pending.next({ type: HttpEventType.UploadProgress, loaded: 5, total: 10 });
    expect(panel.progreso()).toBe(50);
    pending.next(new HttpResponse({ body: entregada })); fixture.detectChanges();
    expect(panel.enviando()).toBeFalse();
    expect(api.consultar).toHaveBeenCalledTimes(2);
    expect(fixture.nativeElement.textContent).toContain('La entrega no implica aprobación ni cierre');
  });
  it('bloquea entrega durante EN_EVALUACION', () => {
    api.consultar.and.returnValue(of({ ...actual, estado: 'EN_EVALUACION', habilitada: false }));
    fixture.componentInstance.cargar(); fixture.componentInstance.archivo = new File(['x'], 'informe.pdf');
    fixture.componentInstance.entregar(); fixture.detectChanges();
    expect(api.entregar).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('input[type=file]')).toBeNull();
  });
  for (const status of [401, 403, 404, 409, 413, 415, 422, 429, 503]) {
    it(`presenta error ${status} y permite nueva consulta`, () => {
      api.consultar.and.returnValue(throwError(() => new HttpErrorResponse({ status })));
      fixture.componentInstance.cargar(); fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[role=alert]')).not.toBeNull();
      expect(fixture.componentInstance.cargando()).toBeFalse();
      api.consultar.and.returnValue(of(actual)); fixture.componentInstance.cargar(); fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[role=alert]')).toBeNull();
    });
  }
  it('bloquea reemplazo tras APROBADO aunque la disponibilidad anterior estuviera habilitada', () => {
    const aprobada: Evaluacion = { id_evaluacion: 'uuid', id_practica: 7, id_documento: 9, version: 1,
      id_docente: 20, estado: 'RESUELTA', resultado: 'APROBADO', observaciones: null, motivo: null,
      inicio: '2026-11-09T12:00:00Z', termino: '2026-11-09T13:00:00Z' };
    academico.consultar.and.returnValue(of({ ...estado, resultado_vigente: aprobada }));
    fixture.componentInstance.cargar(); fixture.detectChanges();
    fixture.componentInstance.archivo = new File(['x'], 'informe.pdf'); fixture.componentInstance.entregar();
    expect(api.entregar).not.toHaveBeenCalled(); expect(fixture.nativeElement.querySelector('input[type=file]')).toBeNull();
  });
  it('habilita corrección y reentrega CON_OBSERVACIONES conservando S4.2', () => {
    const observada: Evaluacion = { id_evaluacion: 'uuid', id_practica: 7, id_documento: 9, version: 1,
      id_docente: 20, estado: 'RESUELTA', resultado: 'CON_OBSERVACIONES', observaciones: 'Corregir', motivo: null,
      inicio: '2026-11-09T12:00:00Z', termino: '2026-11-09T13:00:00Z' };
    academico.consultar.and.returnValue(of({ ...estado, resultado_vigente: observada }));
    fixture.componentInstance.cargar(); fixture.detectChanges();
    expect(fixture.componentInstance.puedeEntregar()).toBeTrue();
    expect(fixture.nativeElement.textContent).toContain('entrega una nueva versión');
    expect(fixture.nativeElement.querySelector('input[type=file]')).not.toBeNull();
  });
  it('no habilita entrega con lectura académica fallida o versión diferente', () => {
    academico.consultar.and.returnValue(throwError(() => new HttpErrorResponse({ status: 403 })));
    fixture.componentInstance.cargar(); fixture.detectChanges();
    expect(fixture.componentInstance.puedeEntregar()).toBeFalse();
    academico.consultar.and.returnValue(of({ ...estado, version: 2 }));
    fixture.componentInstance.cargar(); fixture.detectChanges();
    expect(fixture.componentInstance.puedeEntregar()).toBeFalse();
  });
  function seleccionar(file: File): void {
    const input = document.createElement('input'); input.type = 'file';
    const files = new DataTransfer(); files.items.add(file); input.files = files.files;
    input.addEventListener('change', event => fixture.componentInstance.seleccionar(event));
    input.dispatchEvent(new Event('change'));
  }
  it('acepta PDF y DOCX con tipo correcto y muestra formato real', () => {
    api.consultar.and.returnValue(of({ ...actual, formato: 'DOCX', mime_type: FORMATOS_INFORME.DOCX.mime, nombre: 'informe.docx' }));
    const panel = fixture.componentInstance; panel.cargar(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Formato: DOCX');
    expect(fixture.nativeElement.textContent).toContain('informe.docx');
    const input: HTMLInputElement = fixture.nativeElement.querySelector('input[type=file]');
    expect(input.accept).toContain('.docx'); expect(input.accept).not.toContain('.docm');
    for (const [name, mime] of [['x.pdf', 'application/pdf'], ['x.docx', FORMATOS_INFORME.DOCX.mime]]) {
      const file = new File(['original'], name, { type: mime }); seleccionar(file);
      expect(panel.archivo).toBe(file); expect(panel.error()).toBe('');
    }
  });
  it('rechaza archivos vacíos, grandes, MIME discordante y formatos ajenos antes de enviar', () => {
    const panel = fixture.componentInstance; panel.cargar(); fixture.detectChanges();
    for (const file of [new File([], 'x.pdf', { type: 'application/pdf' }),
      new File([new ArrayBuffer(10485761)], 'x.docx', { type: FORMATOS_INFORME.DOCX.mime }),
      new File(['x'], 'x.pdf', { type: FORMATOS_INFORME.DOCX.mime }),
      new File(['x'], 'x.docx', { type: 'application/pdf' }),
      new File(['x'], 'x.docm', { type: FORMATOS_INFORME.DOCX.mime }), new File(['x'], 'x.txt')]) {
      seleccionar(file); panel.entregar();
      expect(panel.archivo).toBeNull(); expect(panel.error()).not.toBe('');
    }
    expect(api.entregar).not.toHaveBeenCalled();
  });
  it('acepta MIME vacío en selección PDF/DOCX y mantiene el límite de tamaño', () => {
    const panel = fixture.componentInstance; panel.cargar(); fixture.detectChanges();
    for (const name of ['informe.PDF', 'informe.docx']) {
      const file = new File(['original'], name);
      seleccionar(file); expect(panel.archivo).toBe(file); expect(panel.error()).toBe('');
    }
    for (const file of [new File([], 'x.docx'), new File([new ArrayBuffer(10485761)], 'x.pdf'),
      new File(['original'], 'x.doc'), new File(['original'], 'x.docm')]) {
      seleccionar(file); expect(panel.archivo).toBeNull(); expect(panel.error()).not.toBe('');
    }
  });
  it('explica Storage solo PDF y conserva clave/version en reintento DOCX', () => {
    const panel = fixture.componentInstance; panel.cargar(); fixture.detectChanges();
    seleccionar(new File(['original'], 'informe.docx', { type: FORMATOS_INFORME.DOCX.mime }));
    api.entregar.and.returnValue(throwError(() => new HttpErrorResponse({ status: 503,
      error: { detail: 'El formato todavía no está habilitado en Storage' } })));
    panel.entregar(); const first = api.entregar.calls.mostRecent().args;
    expect(panel.error()).toContain('DOCX todavía no está disponible');
    panel.entregar(); expect(api.entregar.calls.mostRecent().args).toEqual(first);
  });
  it('descarga DOCX con nombre recibido del servicio sin perder el original', fakeAsync(() => {
      const panel = fixture.componentInstance; panel.cargar();
      const blob = new Blob(['original'], { type: FORMATOS_INFORME.DOCX.mime });
      api.descargar.and.returnValue(of({ blob, nombre: 'informe-final.docx' }));
      const create = spyOn(URL, 'createObjectURL').and.returnValue('blob:synthetic');
      const revoke = spyOn(URL, 'revokeObjectURL');
      let downloaded = '';
      spyOn(HTMLAnchorElement.prototype, 'click').and.callFake(function (this: HTMLAnchorElement) { downloaded = this.download; });
      panel.descargar(); expect(downloaded).toBe('informe-final.docx');
      expect(create).toHaveBeenCalledOnceWith(blob); expect(panel.cargando()).toBeFalse();
      tick(1000); expect(revoke).toHaveBeenCalledOnceWith('blob:synthetic');
  }));
  for (const [status, message] of [[413, '10 MiB'], [415, 'Formato no admitido'],
    [422, 'Informe inválido'], [429, 'validación está ocupada'], [503, 'validador o el almacenamiento']] as const) {
    it(`explica error de entrega ${status} sin perder archivo ni clave`, () => {
      const panel = fixture.componentInstance; panel.cargar(); fixture.detectChanges();
      const file = new File(['original'], 'informe.docx', { type: FORMATOS_INFORME.DOCX.mime });
      seleccionar(file);
      api.entregar.and.returnValue(throwError(() => new HttpErrorResponse({ status })));
      panel.entregar(); const first = api.entregar.calls.mostRecent().args;
      expect(panel.error()).toContain(message); expect(panel.archivo).toBe(file);
      expect(panel.enviando()).toBeFalse(); panel.entregar();
      expect(api.entregar.calls.mostRecent().args).toEqual(first);
    });
  }
  it('descarta respuestas de la práctica anterior y limpia datos al cambiar identificador', () => {
    const pending = new Subject<Informe>(); api.consultar.and.returnValue(pending);
    fixture.componentInstance.cargar();
    fixture.componentRef.setInput('idPractica', 8); fixture.detectChanges();
    expect(pending.observed).toBeFalse(); pending.next(actual);
    expect(fixture.componentInstance.informe()).toBeNull();
    expect(fixture.componentInstance.archivo).toBeNull();
  });
});

describe('InformeService: contrato HTTP aislado', () => {
  let api: InformeService; let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(InformeService); http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  it('envía bytes y claves sin identidad de actor ni ruta Storage', () => {
    const file = new File(['synthetic'], 'informe.pdf', { type: 'application/pdf' });
    api.entregar(7, file, 'synthetic-key', 1).subscribe();
    const request = http.expectOne(`${environment.apiUrl}/practicas/7/informe-final`);
    expect(request.request.method).toBe('POST'); expect(request.request.body).toBe(file);
    expect(request.request.headers.get('Idempotency-Key')).toBe('synthetic-key');
    expect(request.request.headers.get('Version-Esperada')).toBe('1');
    expect(request.request.headers.has('Id-Actor')).toBeFalse();
    request.flush({ version: 2 });
  });
  it('descarga bytes desde FastAPI sin URL pública ni firmada', () => {
    api.descargar(7).subscribe(archivo => { expect(archivo.blob.type).toBe('application/pdf'); expect(archivo.nombre).toBe('informe-final.pdf'); });
    const request = http.expectOne(`${environment.apiUrl}/practicas/7/informe-final/archivo`);
    expect(request.request.responseType).toBe('blob'); request.flush(new Blob(['synthetic'], { type: 'application/pdf' }), { headers: { 'Content-Type': 'application/pdf' } });
  });
  it('envía DOCX binario con MIME, nombre codificado y versión esperada', () => {
    const file = new File(['original'], 'informe final.docx', { type: FORMATOS_INFORME.DOCX.mime });
    api.entregar(7, file, 'same-key', 2).subscribe();
    const request = http.expectOne(`${environment.apiUrl}/practicas/7/informe-final`);
    expect(request.request.body).toBe(file);
    expect(request.request.headers.get('Content-Type')).toBe(FORMATOS_INFORME.DOCX.mime);
    expect(request.request.headers.get('Nombre-Archivo')).toBe('informe%20final.docx');
    expect(request.request.headers.get('Idempotency-Key')).toBe('same-key');
    expect(request.request.headers.get('Version-Esperada')).toBe('2');
    request.flush({ ...entregada, formato: 'DOCX', mime_type: FORMATOS_INFORME.DOCX.mime });
  });
  it('no envía HTTP para MIME discordante', () => {
    api.entregar(7, new File(['x'], 'x.docx', { type: 'application/pdf' }), 'key', 0).subscribe({
      error: (error: HttpErrorResponse) => expect(error.status).toBe(422)
    });
    http.expectNone(`${environment.apiUrl}/practicas/7/informe-final`);
  });
  it('consulta SIN_ENTREGAR con formato y MIME nulos', () => {
    const empty: Informe = { ...actual, estado: 'SIN_ENTREGAR', version: 0, id_documento: null, nombre: null, formato: null, mime_type: null };
    api.consultar(7).subscribe(value => { expect(value.formato).toBeNull(); expect(value.mime_type).toBeNull(); });
    http.expectOne(`${environment.apiUrl}/practicas/7/informe-final`).flush(empty);
  });
  it('deriva la extensión DOCX del Content-Type HTTP sin Content-Disposition', () => {
    api.descargar(7).subscribe(archivo => { expect(archivo.nombre).toBe('informe-final.docx'); expect(archivo.blob.size).toBe(8); });
    http.expectOne(`${environment.apiUrl}/practicas/7/informe-final/archivo`).flush(
      new Blob(['original'], { type: FORMATOS_INFORME.DOCX.mime }), { headers: { 'Content-Type': FORMATOS_INFORME.DOCX.mime } });
  });
  it('rechaza descarga con MIME desconocido en lugar de inventar extensión', () => {
    api.descargar(7).subscribe({ error: (error: HttpErrorResponse) => expect(error.status).toBe(502) });
    http.expectOne(`${environment.apiUrl}/practicas/7/informe-final/archivo`).flush(
      new Blob(['x']), { headers: { 'Content-Type': 'text/html' } });
  });
  for (const [name, mime] of [['informe.PDF', FORMATOS_INFORME.PDF.mime],
    ['informe.docx', FORMATOS_INFORME.DOCX.mime]]) {
    it(`envía MIME canónico para ${name} con MIME del navegador vacío`, () => {
      const file = new File(['original'], name);
      expect(file.type).toBe('');
      api.entregar(7, file, 'same-key', 2).subscribe();
      const request = http.expectOne(`${environment.apiUrl}/practicas/7/informe-final`);
      expect(request.request.body).toBe(file);
      expect(request.request.headers.get('Content-Type')).toBe(mime);
      expect(request.request.headers.get('Idempotency-Key')).toBe('same-key');
      expect(request.request.headers.get('Version-Esperada')).toBe('2');
      expect(request.request.headers.get('Nombre-Archivo')).toBe(encodeURIComponent(name));
      request.flush(entregada);
    });
  }
  it('rechaza MIME vacío en extensiones ajenas, archivos vacíos o excesivos sin HTTP', () => {
    for (const file of [new File(['x'], 'x.docm'), new File(['x'], 'x.zip'), new File([], 'x.pdf'),
      new File([new ArrayBuffer(10485761)], 'x.docx')]) {
      let status = 0;
      api.entregar(7, file, 'key', 0).subscribe({ error: (error: HttpErrorResponse) => { status = error.status; } });
      expect(status).toBe(422);
    }
    http.expectNone(`${environment.apiUrl}/practicas/7/informe-final`);
  });

});
