param([Parameter(Mandatory = $true)][string]$Manifest)

$ErrorActionPreference = 'Stop'
$jobs = Get-Content -LiteralPath $Manifest -Raw -Encoding UTF8 | ConvertFrom-Json
$excel = $null
try {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.AutomationSecurity = 3
  try { $excel.Calculation = -4135 } catch {}
  foreach ($job in $jobs) {
    Copy-Item -LiteralPath $job.input -Destination $job.output -Force
    $book = $null
    try {
      $book = $excel.Workbooks.Open($job.output, 0, $false)
      foreach ($patch in $job.patches) {
        $sheet = $book.Worksheets.Item([string]$patch.sheet)
        $sheet.Cells.Item([int]$patch.row, [int]$patch.column).Value2 = [double]$patch.value
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($sheet)
      }
      $book.Save()
    } finally {
      if ($null -ne $book) {
        $book.Close($false)
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($book)
      }
    }
  }
} finally {
  if ($null -ne $excel) {
    $excel.Quit()
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
