param(
    [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
)

Add-Type -AssemblyName System.Drawing

function Draw-PracticaLinkMark {
    param([System.Drawing.Graphics]$Graphics)

    $white = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
    $pageLeft = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $pageLeft.AddBezier(22, 36, 32, 30, 43, 31, 54, 38)
    $pageLeft.AddLine(54, 38, 54, 76)
    $pageLeft.AddBezier(54, 76, 44, 70, 33, 69, 22, 74)
    $pageLeft.CloseFigure()
    $Graphics.FillPath($white, $pageLeft)

    $pageRight = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $pageRight.AddBezier(54, 38, 65, 31, 76, 30, 86, 36)
    $pageRight.AddLine(86, 36, 86, 74)
    $pageRight.AddBezier(86, 74, 75, 69, 64, 70, 54, 76)
    $pageRight.CloseFigure()
    $Graphics.FillPath($white, $pageRight)

    $detailPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(184, 201, 220), 2.4)
    $detailPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $detailPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $Graphics.DrawLine($detailPen, 29, 47, 46, 49)
    $Graphics.DrawLine($detailPen, 29, 57, 46, 59)
    $Graphics.DrawLine($detailPen, 79, 47, 62, 49)
    $Graphics.DrawLine($detailPen, 79, 57, 62, 59)

    $linkPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(5, 150, 105), 5)
    $linkPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $linkPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $linkPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

    $linkLeft = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $linkLeft.AddLine(48, 59, 43, 64)
    $linkLeft.AddBezier(43, 64, 39, 68, 39, 73, 43, 77)
    $linkLeft.AddBezier(43, 77, 47, 81, 52, 80, 56, 76)
    $linkLeft.AddLine(56, 76, 61, 71)
    $Graphics.DrawPath($linkPen, $linkLeft)

    $linkRight = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $linkRight.AddLine(60, 49, 65, 44)
    $linkRight.AddBezier(65, 44, 69, 40, 74, 40, 78, 44)
    $linkRight.AddBezier(78, 44, 82, 48, 81, 53, 77, 57)
    $linkRight.AddLine(77, 57, 70, 64)
    $Graphics.DrawPath($linkPen, $linkRight)
    $Graphics.DrawLine($linkPen, 49, 59, 59, 49)

    $white.Dispose()
    $pageLeft.Dispose()
    $pageRight.Dispose()
    $detailPen.Dispose()
    $linkPen.Dispose()
    $linkLeft.Dispose()
    $linkRight.Dispose()
}

function Save-LauncherImage {
    param(
        [string]$Path,
        [int]$Size,
        [bool]$Round = $false,
        [bool]$ForegroundOnly = $false
    )

    $bitmap = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.Clear([System.Drawing.Color]::Transparent)

    if (-not $ForegroundOnly) {
        $background = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(15, 41, 74))
        if ($Round) { $graphics.FillEllipse($background, 0, 0, $Size, $Size) }
        else { $graphics.FillRectangle($background, 0, 0, $Size, $Size) }
        $background.Dispose()
    }

    $graphics.ScaleTransform($Size / 108.0, $Size / 108.0)
    Draw-PracticaLinkMark -Graphics $graphics

    $folder = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $folder)) { New-Item -ItemType Directory -Path $folder -Force | Out-Null }
    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose()
    $bitmap.Dispose()
}

$densitySizes = @{
    'mipmap-mdpi' = 48
    'mipmap-hdpi' = 72
    'mipmap-xhdpi' = 96
    'mipmap-xxhdpi' = 144
    'mipmap-xxxhdpi' = 192
}

foreach ($density in $densitySizes.Keys) {
    $folder = Join-Path $ProjectRoot "android/app/src/main/res/$density"
    $size = $densitySizes[$density]
    Save-LauncherImage -Path (Join-Path $folder 'ic_launcher.png') -Size $size
    Save-LauncherImage -Path (Join-Path $folder 'ic_launcher_round.png') -Size $size -Round $true
    Save-LauncherImage -Path (Join-Path $folder 'ic_launcher_foreground.png') -Size $size -ForegroundOnly $true
}
