param([ValidateSet(1,2,3,4,5,7)][int]$LotId = 1, [string]$CoordinateFile, [string]$OutputFile, [string]$SpecificationFile)
# 元の地図は変更せず、現在の座標と番号を重ねた確認用の画像を作る。
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$projectDirectory = Split-Path -Parent $PSScriptRoot
$specificationPath = if ($SpecificationFile) { $SpecificationFile } else { Join-Path $projectDirectory ("docs/lot-{0}-map-rows.json" -f $LotId) }
$spec = Get-Content -LiteralPath $specificationPath -Raw -Encoding UTF8 | ConvertFrom-Json
$coordinatePath = if ($CoordinateFile) { $CoordinateFile } else { Join-Path $projectDirectory ("public/data/parking-spots/lot-{0}.json" -f $LotId) }
$spots = Get-Content -LiteralPath $coordinatePath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($spots.Count -ne $spec.capacity) { throw '測定値と座標ファイルの台数が一致していません。' }
$scale = 2
$sourceImage = [System.Drawing.Image]::FromFile((Join-Path $projectDirectory $spec.image))
$bitmap = [System.Drawing.Bitmap]::new(($spec.width * $scale), ($spec.height * $scale))
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$fill = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(70, 39, 174, 96))
$outline = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(190, 25, 130, 75), 0.8)
$textBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(25, 65, 35))
$numberFontSize = if ($spec.previewFontSize) { [single]$spec.previewFontSize } else { 8 }
$font = [System.Drawing.Font]::new('Arial', $numberFontSize, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$headingFont = [System.Drawing.Font]::new('Yu Gothic UI', 24, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$reviewOutline = [System.Drawing.Pen]::new([System.Drawing.Color]::DarkOrange, 3)
$captionFont = $null
$format = [System.Drawing.StringFormat]::new()
$format.Alignment = [System.Drawing.StringAlignment]::Center
$format.LineAlignment = [System.Drawing.StringAlignment]::Center
try {
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $graphics.DrawImage($sourceImage, 0, 0, $bitmap.Width, $bitmap.Height)
    if ($spec.displayCaption) {
        $graphics.FillRectangle([System.Drawing.Brushes]::White, 0, 0, ($spec.displayCaption.width * $scale), ($spec.displayCaption.height * $scale))
        $captionFont = [System.Drawing.Font]::new('Yu Mincho', (24 * $scale), [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
        $graphics.DrawString($spec.displayCaption.text, $captionFont, [System.Drawing.Brushes]::Black, (10 * $scale), 0)
    }
    foreach ($spot in $spots) {
        $points = [System.Drawing.PointF[]]@()
        $centerX = 0.0
        $centerY = 0.0
        foreach ($point in $spot.polygon) {
            $x = [single]($point[0] * $spec.width * $scale / 100)
            $y = [single]($point[1] * $spec.height * $scale / 100)
            $points += [System.Drawing.PointF]::new($x, $y)
            $centerX += $x / $spot.polygon.Count
            $centerY += $y / $spot.polygon.Count
        }
        $graphics.FillPolygon($fill, $points)
        $graphics.DrawPolygon($outline, $points)
        if ($spec.reviewSpotIds -contains $spot.id) { $graphics.DrawPolygon($reviewOutline, $points) }
        if ($LotId -eq 7) {
            $labelSize = $graphics.MeasureString([string]$spot.id, $font)
            $graphics.FillRectangle([System.Drawing.Brushes]::White, ($centerX - $labelSize.Width / 2), ($centerY - $labelSize.Height / 2), $labelSize.Width, $labelSize.Height)
        }
        $graphics.DrawString([string]$spot.id, $font, $textBrush, [System.Drawing.PointF]::new($centerX, $centerY), $format)
    }
    foreach ($pending in $spec.previewPendingAreas) {
        $points = [System.Drawing.PointF[]]@($pending.polygon | ForEach-Object { [System.Drawing.PointF]::new(($_[0] * $scale), ($_[1] * $scale)) })
        $graphics.DrawPolygon($reviewOutline, $points)
        $centerX = ($points | Measure-Object -Property X -Average).Average
        $centerY = ($points | Measure-Object -Property Y -Average).Average
        $graphics.DrawString($pending.label, $font, [System.Drawing.Brushes]::DarkOrange, [System.Drawing.PointF]::new($centerX, $centerY), $format)
    }
    $heading = if ($spec.previewHeading) { $spec.previewHeading } else { '第' + $LotId + '駐車場：' + $spec.capacity + '台（エリアごとに1〜' + $spec.capacity + '番の連番）' }
    $graphics.DrawString($heading, $headingFont, $textBrush, 12, 60)
    $noteY = 96
    foreach ($note in $spec.previewNotes) {
        $graphics.DrawString($note, $headingFont, $textBrush, 12, $noteY)
        $noteY += 30
    }
    $outputPath = if ($OutputFile) { $OutputFile } else { Join-Path $projectDirectory ("docs/lot-{0}-map-preview.png" -f $LotId) }
    $bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Output $outputPath
} finally {
    if ($captionFont) { $captionFont.Dispose() }
    $reviewOutline.Dispose()
    $format.Dispose()
    $headingFont.Dispose()
    $font.Dispose()
    $textBrush.Dispose()
    $outline.Dispose()
    $fill.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
    $sourceImage.Dispose()
}
