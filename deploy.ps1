<#
.SYNOPSIS
    Build le plugin Jump to Same Paragraph et le copie dans le dossier plugins du vault Obsidian.

.PARAMETER VaultPath
    Racine du vault (le dossier qui contient .obsidian). Par défaut, le vault "journal"
    synchronisé via Google Drive.
#>
param(
	[string]$VaultPath = "G:\Mon Drive\txt\journal"
)

$ErrorActionPreference = "Stop"

# "Copier en tant que chemin" dans l'Explorateur entoure le chemin de guillemets. Un chemin relatif
# s'entend depuis là où le script a été lancé : on le résout avant de changer de répertoire.
$VaultPath = $VaultPath.Trim().Trim('"', "'")
if (-not (Test-Path -LiteralPath (Join-Path $VaultPath ".obsidian"))) {
	throw "Pas de dossier .obsidian dans '$VaultPath' : ce n'est pas la racine d'un vault Obsidian."
}
$VaultPath = (Resolve-Path -LiteralPath $VaultPath).ProviderPath

# Le script doit pouvoir être lancé depuis n'importe où : sans cela, npm construirait le projet du
# répertoire courant, et Copy-Item y chercherait les fichiers à déployer.
Push-Location $PSScriptRoot
try {
	$PluginId = (Get-Content manifest.json -Raw | ConvertFrom-Json).id

	if (-not (Test-Path node_modules)) {
		npm install
		if ($LASTEXITCODE -ne 0) {
			throw "npm install a échoué (code $LASTEXITCODE) : rien n'a été déployé."
		}
	}

	npm run build
	# $ErrorActionPreference ne couvre pas les commandes natives : sans ce test, un build cassé
	# laisserait déployer le main.js de la fois précédente, en annonçant un succès.
	if ($LASTEXITCODE -ne 0) {
		throw "npm run build a échoué (code $LASTEXITCODE) : rien n'a été déployé."
	}

	$TargetDir = Join-Path $VaultPath ".obsidian\plugins\$PluginId"
	New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
	Copy-Item main.js, manifest.json, styles.css -Destination $TargetDir -Force
}
finally {
	Pop-Location
}

Write-Host "Plugin déployé dans $TargetDir" -ForegroundColor Green

$CommunityPlugins = Join-Path $VaultPath ".obsidian\community-plugins.json"
$Enabled = (Test-Path -LiteralPath $CommunityPlugins) -and
	(@(Get-Content -LiteralPath $CommunityPlugins -Raw | ConvertFrom-Json) -contains $PluginId)
# Lazy Plugin Loader retire de cette liste les modules qu'il charge lui-même en différé, et ceux qu'il garde
# désactivés : c'est son réglage qui décide.
$LazyPlugins = Join-Path $VaultPath ".obsidian\plugins\lazy-plugins\data.json"
$LazyStartup = $null
if (Test-Path -LiteralPath $LazyPlugins) {
	$LazyStartup = (Get-Content -LiteralPath $LazyPlugins -Raw | ConvertFrom-Json).desktop.plugins.$PluginId.startupType
}

if ($LazyStartup -eq "disabled") {
	Write-Host "Lazy Plugin Loader garde ce module désactivé : dans ses réglages, choisis « instant » pour" -ForegroundColor Yellow
	Write-Host "« Jump to Same Paragraph », puis recharge Obsidian (Ctrl+R)." -ForegroundColor Yellow
}
elseif ($Enabled -or $LazyStartup) {
	Write-Host "Recharge Obsidian (Ctrl+R) pour prendre en compte cette version."
}
else {
	Write-Host "Si ce n'est pas déjà fait, active « Jump to Same Paragraph » dans Paramètres > Modules complémentaires,"
	Write-Host "puis recharge Obsidian (Ctrl+R) après chaque nouveau déploiement."
}
