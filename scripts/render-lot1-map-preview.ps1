param([string]$CoordinateFile, [string]$OutputFile)
& (Join-Path $PSScriptRoot 'render-parking-map-preview.ps1') -LotId 1 -CoordinateFile $CoordinateFile -OutputFile $OutputFile