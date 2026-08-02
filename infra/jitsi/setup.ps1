# Downloads the latest docker-jitsi-meet release into infra/jitsi/docker-jitsi-meet/.
# Idempotent: skips the download if that folder already exists (delete it to re-fetch).
# Deliberately NOT a git clone — official guidance is that clone is for
# unstable/dev builds only; a tagged release is what's meant for real use.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$target = Join-Path $root "docker-jitsi-meet"

if (Test-Path $target) {
    Write-Host "infra/jitsi/docker-jitsi-meet already exists - skipping download. Delete it first to re-fetch."
    exit 0
}

Write-Host "Querying latest docker-jitsi-meet release..."
$release = Invoke-RestMethod -Uri "https://api.github.com/repos/jitsi/docker-jitsi-meet/releases/latest" -Headers @{ "User-Agent" = "antigravity-setup" }
$tag = $release.tag_name
Write-Host "Latest release: $tag"

$zipUrl = "https://github.com/jitsi/docker-jitsi-meet/archive/refs/tags/$tag.zip"
$zipPath = Join-Path $root "docker-jitsi-meet.zip"
Write-Host "Downloading $zipUrl ..."
Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath

Write-Host "Extracting..."
$extractDir = Join-Path $root "_extract"
Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

# GitHub's archive zip contains exactly one top-level folder, typically
# "docker-jitsi-meet-<tag-with-slashes-replaced-by-dashes>".
$extractedFolder = Get-ChildItem -Path $extractDir -Directory | Select-Object -First 1
Move-Item -Path $extractedFolder.FullName -Destination $target

Remove-Item -Path $zipPath -Force
Remove-Item -Path $extractDir -Recurse -Force

Write-Host "Done. docker-jitsi-meet $tag extracted to infra/jitsi/docker-jitsi-meet/"
Write-Host "Next: follow infra/jitsi/README.md starting from step 2."
