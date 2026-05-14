param(
  [string]$ExtensionPath = (Join-Path (Split-Path -Parent $PSScriptRoot) "extension"),
  [switch]$OpenChromeExtensions
)

$ErrorActionPreference = "Stop"

if (!(Test-Path -LiteralPath (Join-Path $ExtensionPath "manifest.json"))) {
  throw "Extension manifest not found: $ExtensionPath"
}

$resolved = (Resolve-Path -LiteralPath $ExtensionPath).Path
Write-Output "Filler Draft Assistant extension path:"
Write-Output $resolved
Write-Output ""
Write-Output "Install steps:"
Write-Output "1. Open chrome://extensions"
Write-Output "2. Enable Developer mode"
Write-Output "3. Click Load unpacked"
Write-Output "4. Choose the extension path above"
Write-Output "5. Accept the debugger permission prompt when Chrome shows it"
Write-Output ""
Write-Output "The extension uses chrome.debugger only to set file inputs through CDP and must stop before final publish."

if ($OpenChromeExtensions) {
  Start-Process "chrome.exe" "chrome://extensions"
}
