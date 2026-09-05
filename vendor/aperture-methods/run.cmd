@echo off
setlocal
set "PYTHONPATH=%~dp0;%PYTHONPATH%"
if exist "%~dp0.venv\Scripts\python.exe" (
    "%~dp0.venv\Scripts\python.exe" -m aperture_methods %*
) else (
    py -3 -m aperture_methods %*
)
exit /b %ERRORLEVEL%
