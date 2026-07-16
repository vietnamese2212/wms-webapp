# ============================================================================
# KHAO SAT MAY TRAM CAN - tim phan mem can + noi luu du lieu phieu can
# Chay tren may tinh TRAM CAN (Windows). Khong sua/xoa gi - CHI DOC.
# Ket qua: file "khao-sat-tram-can.txt" tren Desktop -> gui lai cho doi WMS.
# (Script viet KHONG DAU de chay duoc tren moi may Windows)
# ============================================================================
$ErrorActionPreference = 'SilentlyContinue'
$out = Join-Path ([Environment]::GetFolderPath('Desktop')) 'khao-sat-tram-can.txt'
$r = New-Object System.Collections.Generic.List[string]
function W($s) { $r.Add([string]$s); Write-Host $s }

W "===== KHAO SAT MAY TRAM CAN - $(Get-Date -Format 'dd/MM/yyyy HH:mm') ====="
$os = (Get-CimInstance Win32_OperatingSystem).Caption
W "May: $env:COMPUTERNAME | User: $env:USERNAME | OS: $os"
W ""

# -- 1. Internet -------------------------------------------------------------
W "-- 1. KET NOI INTERNET --"
$net = Test-Connection -ComputerName 8.8.8.8 -Count 1 -Quiet
if ($net) { W "Ping Internet: CO" } else { W "Ping Internet: KHONG" }
try {
  $wms = Invoke-WebRequest -Uri 'https://wms-webapp.vercel.app' -UseBasicParsing -TimeoutSec 10
  W "Goi thu WMS cloud: HTTP $($wms.StatusCode)"
} catch { W "Goi thu WMS cloud: LOI ($($_.Exception.Message))" }
W ""

# -- 2. Tien trinh / phan mem nghi la PM can ---------------------------------
W "-- 2. PHAN MEM CAN DANG CHAY / DA CAI --"
$kw = 'can|scale|weigh|kinhbac|kinh bac|tram|KBC'
Get-Process | Where-Object { $_.MainWindowTitle -and ($_.ProcessName -match $kw -or $_.MainWindowTitle -match $kw) } | ForEach-Object {
  W "Dang chay: $($_.ProcessName) | cua so: '$($_.MainWindowTitle)' | file: $($_.Path)"
}
$paths = @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*')
foreach ($hive in $paths) {
  Get-ItemProperty $hive | Where-Object { $_.DisplayName -match $kw } | ForEach-Object {
    W "Da cai: $($_.DisplayName) | thu muc: $($_.InstallLocation)"
  }
}
W ""

# -- 3. SQL Server tren may ---------------------------------------------------
W "-- 3. SQL SERVER --"
$sqlSvc = Get-Service | Where-Object { $_.Name -match 'MSSQL' }
if ($sqlSvc) { $sqlSvc | ForEach-Object { W "Service: $($_.Name) | $($_.Status)" } } else { W "Khong thay service SQL Server" }
$inst = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server'
if ($inst -and $inst.InstalledInstances) { W "Instance: $($inst.InstalledInstances -join ', ')" }
W ""

# -- 4. ODBC DSN (duong noi DB da khai tren may) ------------------------------
W "-- 4. ODBC DSN --"
$dsnPaths = @('HKLM:\SOFTWARE\ODBC\ODBC.INI\ODBC Data Sources','HKCU:\SOFTWARE\ODBC\ODBC.INI\ODBC Data Sources')
foreach ($p in $dsnPaths) {
  $ds = Get-ItemProperty $p
  if ($ds) { $ds.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } | ForEach-Object { W "DSN: $($_.Name) = $($_.Value)" } }
}
W ""

# -- 5. Tim file DB (Access .mdb/.accdb, SQL .mdf, SQLite .db) ----------------
W "-- 5. FILE DATABASE TIM THAY (sap theo ngay sua moi nhat) --"
W "(File co 'ngay sua' GAN DAY nhat nhieu kha nang la DB dang luu phieu can)"
$roots = @('C:\','D:\','E:\') | Where-Object { Test-Path $_ }
$found = @()
foreach ($root in $roots) {
  Write-Host "  ...dang quet $root (co the mat vai phut)"
  # Duyet thu muc cap 1 truoc, bo qua thu muc he thong/nang -> quet sau moi nhanh
  $dirs = Get-ChildItem -Path $root -Directory | Where-Object { $_.Name -notmatch '^(Windows|WinSxS|OneDrive.*|\$Recycle|node_modules|ProgramData)$' }
  foreach ($d in $dirs) {
    $found += Get-ChildItem -Path $d.FullName -Recurse -Depth 3 -Include *.mdb,*.accdb,*.mdf,*.sdf,*.fdb -File |
      Where-Object { $_.FullName -notmatch '\\Windows\\|\\WinSxS\\|OneDrive|node_modules|\\AppData\\Local\\Temp' }
  }
  $found += Get-ChildItem -Path $root -Include *.mdb,*.accdb,*.mdf,*.sdf,*.fdb -File
}
$found | Sort-Object LastWriteTime -Descending | Select-Object -First 40 | ForEach-Object {
  $mb = [math]::Round($_.Length / 1MB, 1)
  W "$($_.FullName)  |  $mb MB  |  sua: $($_.LastWriteTime.ToString('dd/MM/yyyy HH:mm'))"
}
if ($found.Count -eq 0) { W "Khong tim thay file DB nao - kha nang dung SQL Server (xem muc 3)" }
W ""

# -- 6. File cau hinh trong thu muc phan mem can (thuong chua connection string)
W "-- 6. FILE CAU HINH GAN PHAN MEM CAN --"
$exeDirs = Get-Process | Where-Object { $_.Path -and ($_.ProcessName -match $kw) } | ForEach-Object { Split-Path $_.Path } | Sort-Object -Unique
foreach ($d in $exeDirs) {
  Get-ChildItem -Path $d -Include *.ini,*.config,*.xml,*.json,*.udl -File -Recurse -Depth 1 | ForEach-Object {
    W "--- $($_.FullName) ---"
    Get-Content $_.FullName -TotalCount 40 | ForEach-Object { W "    $_" }
  }
}
if (-not $exeDirs) { W "(Phan mem can KHONG chay luc khao sat - hay MO phan mem can len roi chay lai file nay)" }
W ""

W "===== HET - gui file nay cho doi WMS ====="
$r | Out-File -FilePath $out -Encoding utf8
Write-Host ""
Write-Host ">>> DA XUAT KET QUA: $out" -ForegroundColor Green
Write-Host ">>> Gui file do cho doi WMS." -ForegroundColor Green
Read-Host "Nhan Enter de thoat"
