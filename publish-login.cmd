@echo off
setlocal
set "PATH=C:\Users\liweichen\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin;%PATH%"
set "NODE=C:\Users\liweichen\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
set "PNPM=C:\Users\liweichen\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.cjs"
cd /d "%~dp0"
echo.
echo === Dota2bp npm login ===
echo Enter your npmjs.com username, password and one-time code when prompted.
echo.
"%NODE%" "%PNPM%" login
if errorlevel 1 (
  echo.
  echo npm login failed. You can retry by running this file again.
  pause
  exit /b 1
)
echo.
echo npm login succeeded.
echo Next: create the GitHub repository dsh-dota2bp, then tell the agent the repository URL.
pause
