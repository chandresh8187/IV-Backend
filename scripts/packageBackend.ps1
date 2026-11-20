param([string]$OutputPath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$backendRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $OutputPath) {
    $OutputPath = Join-Path $backendRoot ('tmp/iv-backend-deploy-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.zip')
}
$archivePath = [IO.Path]::GetFullPath($OutputPath)
if ([IO.Path]::GetExtension($archivePath) -ne '.zip') { throw 'Output must be a ZIP file.' }
if (Test-Path -LiteralPath $archivePath) { throw "Output already exists: $archivePath" }
$archiveParent = Split-Path -Parent $archivePath
[IO.Directory]::CreateDirectory($archiveParent) | Out-Null
$runtimeFolders = @('assets','config','controllers','database','middleware','migrations','routes','scripts','services','utils')
$runtimeExtensions = @('.js','.cjs','.mjs','.sql','.png','.jpg','.jpeg','.svg','.webp','.ps1')
$sourceFiles = @('package.json','package-lock.json','server.js') | ForEach-Object { Get-Item -LiteralPath (Join-Path $backendRoot $_) }
foreach ($folder in $runtimeFolders) {
    $sourceFiles += Get-ChildItem -LiteralPath (Join-Path $backendRoot $folder) -Recurse -File |
        Where-Object { $_.Extension.ToLowerInvariant() -in $runtimeExtensions -and -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) }
}
$stream = [IO.File]::Open($archivePath, [IO.FileMode]::CreateNew)
$archive = New-Object IO.Compression.ZipArchive($stream, [IO.Compression.ZipArchiveMode]::Create, $false)
try {
    foreach ($sourceFile in ($sourceFiles | Sort-Object FullName -Unique)) {
        $relative = $sourceFile.FullName.Substring($backendRoot.Length + 1).Replace('\','/')
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $sourceFile.FullName, $relative, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally { $archive.Dispose(); $stream.Dispose() }
$check = [IO.Compression.ZipFile]::OpenRead($archivePath)
try {
    $names = @($check.Entries | ForEach-Object FullName)
    foreach ($required in @('server.js','package.json','package-lock.json','assets/pdf/IV_logo.png','assets/pdf/stamp.png','scripts/migrate.js','scripts/migrateUnit1Coils.js','scripts/migrateUnit1Planning.js','database/unit1_production_planning.sql','services/unit1Planning.js','routes/unit1PlanningRoutes.js','database/unit1_material_stock.sql','database/unit1_maintenance.sql','database/unit1_maintenance_sessions.sql','migrations/versioned/20261028000100_create_gas_bottle_returns.sql')) {
        if ($required -notin $names) { throw "Missing runtime file: $required" }
    }
    if ($names | Where-Object { $_ -match '(^|/)(node_modules|\.git|tmp|tests|docs|uploads)(/|$)|(^|/)\.env|\.zip$' }) { throw 'Archive contains excluded files.' }
    [pscustomobject]@{Path=$archivePath;SizeMB=[math]::Round((Get-Item -LiteralPath $archivePath).Length / 1MB,2);Files=$names.Count} | Format-List
} finally { $check.Dispose() }
