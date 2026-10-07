@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js non e installato.
  echo Installa la versione LTS da https://nodejs.org e riapri questo file.
  set "EXIT_CODE=1"
  goto :finish
)

for /f "tokens=1 delims=." %%V in ('node -p "process.versions.node"') do set "NODE_MAJOR=%%V"
if not defined NODE_MAJOR (
  echo Non e stato possibile controllare la versione di Node.js.
  set "EXIT_CODE=1"
  goto :finish
)
if %NODE_MAJOR% LSS 20 (
  echo La versione di Node.js installata e troppo vecchia.
  echo Installa la versione LTS corrente da https://nodejs.org.
  set "EXIT_CODE=1"
  goto :finish
)

where npm >nul 2>&1
if errorlevel 1 (
  echo npm non e disponibile. Reinstalla Node.js dalla pagina https://nodejs.org.
  set "EXIT_CODE=1"
  goto :finish
)

if not exist "node_modules\.bin\tsx.cmd" goto :install_dependencies
if not exist "node_modules\.bin\cross-env.cmd" goto :install_dependencies
goto :run

:install_dependencies
  echo Prima configurazione: installazione dei componenti necessari...
  echo Questa operazione richiede una connessione Internet.
  call npm ci --include=dev --no-audit --no-fund
  if errorlevel 1 (
    set "EXIT_CODE=1"
    goto :finish
  )
  echo.

:run
call npm run start
set "EXIT_CODE=%ERRORLEVEL%"

:finish
echo.
if "%EXIT_CODE%"=="0" (
  echo Operazione terminata.
) else (
  echo Il programma si e fermato con un errore.
  echo Leggi il messaggio sopra oppure consulta docs\GUIDA-CLIENTE.md.
)
echo Premi un tasto per chiudere questa finestra...
pause >nul
exit /b %EXIT_CODE%
