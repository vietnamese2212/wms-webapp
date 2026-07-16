# ============================================================================
# AGENT TRAM CAN -> WMS
# Doc phieu can tu DB Access cua phan mem can (Can Kinh Bac, bang WeightForm)
# roi day len WMS qua API key. Chay lap vo han (poll). CHI DOC DB can.
# Cach chay: sua khoi CONFIG duoi day -> nhay dup CHAY-AGENT.bat
# Yeu cau: may Windows co Microsoft ACE OLEDB (co san khi cai Office/Access
# hoac cai "Microsoft Access Database Engine 2016 Redistributable" mien phi).
# (Script viet KHONG DAU de chay duoc tren moi may Windows)
# ============================================================================

# ----------------- CONFIG (SUA O DAY) ---------------------------------------
$MdbPath     = 'C:\CanOto\TVTDB.mdb'      # duong dan file TVTDB.mdb (local hoac \\may-can\share\TVTDB.mdb)
$MdbPassword = 'nhucu2012'                # password DB (trong file .config cua PM can)
$WmsUrl      = 'https://wms-webapp-git-dev-vietnamese2212s-projects.vercel.app'  # URL WMS (production: https://wms-webapp.vercel.app)
$ApiKey      = 'DAN_API_KEY_VAO_DAY'      # API key co scope weigh:write (admin WMS cap)
$StationCode = 'KB01'                     # ma tram can (nhieu tram thi dat khac nhau)
$PollSeconds = 20                         # bao lau quet 1 lan
$BatchRows   = 100                        # moi vong lay N phieu MOI NHAT (upsert nen gui lai vo hai)
# -----------------------------------------------------------------------------

$ErrorActionPreference = 'Stop'
$logFile = Join-Path $PSScriptRoot 'agent-tram-can.log'
function Log($s) {
  $line = "$(Get-Date -Format 'dd/MM HH:mm:ss')  $s"
  Write-Host $line
  Add-Content -Path $logFile -Value $line
}

# Chon provider doc Access co san tren may (ACE 16/12 = Office moi; Jet 4.0 = may cu 32-bit -
# PM can Kinh Bac dung Jet 4.0 nen may can CHAC CHAN co, nhung Jet chi thay duoc tu PowerShell 32-bit)
$provider = $null
foreach ($p in 'Microsoft.ACE.OLEDB.16.0','Microsoft.ACE.OLEDB.12.0','Microsoft.Jet.OLEDB.4.0') {
  try {
    $test = New-Object System.Data.OleDb.OleDbConnection("Provider=$p;Data Source=$MdbPath;Jet OLEDB:Database Password=$MdbPassword")
    $test.Open(); $test.Close(); $provider = $p; break
  } catch { }
}
if (-not $provider) {
  if ([Environment]::Is64BitProcess) {
    # May chi co Jet 4.0 (32-bit) -> bao .bat chay lai bang PowerShell 32-bit (exit 2)
    Log "Khong thay provider 64-bit - chuyen sang che do 32-bit (Jet 4.0)..."
    exit 2
  }
  Log "LOI: khong mo duoc DB. Kiem tra: (1) duong dan $MdbPath, (2) password, (3) file dang bi khoa."
  Read-Host 'Nhan Enter de thoat'; exit 1
}
Log "Bat dau agent | DB: $MdbPath | provider: $provider | WMS: $WmsUrl | tram: $StationCode | poll: ${PollSeconds}s"

$cols = 'id, OrderNum, GDate, TruckNum, TransCompany, GoodsName, GrossWeight, TareWeight, NetWeight, GrossTime, TareTime, GInTime, GOutTime, ImExType, InOut'
$lastSent = ''   # dau van cua lo truoc - trung thi khoi goi mang cho do ton

while ($true) {
  try {
    # 1. Doc N phieu moi nhat (lay ca phieu cu vua duoc can lan 2 nho ORDER BY id DESC + upsert)
    $cn = New-Object System.Data.OleDb.OleDbConnection("Provider=$provider;Data Source=$MdbPath;Jet OLEDB:Database Password=$MdbPassword")
    $cn.Open()
    $cmd = New-Object System.Data.OleDb.OleDbCommand("SELECT TOP $BatchRows $cols FROM WeightForm ORDER BY id DESC", $cn)
    $da = New-Object System.Data.OleDb.OleDbDataAdapter($cmd)
    $dt = New-Object System.Data.DataTable
    [void]$da.Fill($dt)
    $cn.Close()

    # 2. DataTable -> mang hashtable (DBNull -> null)
    $tickets = @()
    foreach ($row in $dt.Rows) {
      $o = @{}
      foreach ($c in $dt.Columns) {
        $v = $row[$c.ColumnName]
        if ($v -is [System.DBNull]) { $v = $null }
        $o[$c.ColumnName] = $v
      }
      $tickets += $o
    }
    if ($tickets.Count -eq 0) { Start-Sleep -Seconds $PollSeconds; continue }

    # 3. Chi goi mang khi du lieu DOI so voi lan gui truoc (dau van = id max + so phieu + tong net)
    $sig = "$($tickets[0].id)|$($tickets.Count)|$(($tickets | ForEach-Object { $_.NetWeight }) -join ',')"
    if ($sig -eq $lastSent) { Start-Sleep -Seconds $PollSeconds; continue }

    # 4. POST len WMS
    $body = @{ station_code = $StationCode; tickets = $tickets } | ConvertTo-Json -Depth 4
    $resp = Invoke-RestMethod -Uri "$WmsUrl/api/integration/v1/weigh/tickets" -Method Post `
      -Headers @{ 'X-API-Key' = $ApiKey } -ContentType 'application/json; charset=utf-8' `
      -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 30
    if ($resp.success) {
      Log "Day $($tickets.Count) phieu (id moi nhat $($tickets[0].id)) -> upsert $($resp.data.upserted), auto-khop $($resp.data.matched)"
      $lastSent = $sig
    } else {
      Log "WMS tra loi: $($resp | ConvertTo-Json -Compress)"
    }
  } catch {
    Log "LOI vong nay: $($_.Exception.Message) (thu lai sau ${PollSeconds}s)"
  }
  Start-Sleep -Seconds $PollSeconds
}
