@echo off
cd /d "%~dp0"
cls
echo Setup SOLUSCUT
echo.
echo [1] Verificando Python...
python --version
if errorlevel 1 goto erro_python

echo [2] Verificando Node.js...
node --version
if errorlevel 1 goto erro_node

echo [3] Criando venv backend...
cd backend
if not exist ".venv" (
  python -m venv .venv
)
call .venv\Scripts\activate.bat

echo [4] Instalando requirements...
pip install -r requirements.txt

echo [5] Configurando frontend...
cd ..\frontend
if not exist "node_modules" (
  npm install
)

cd ..
echo.
echo Sucesso! Agora execute:
echo - Duplo-clique start_backend.bat
echo - Duplo-clique start_frontend.bat
echo.
pause
exit /b 0

:erro_python
echo ERRO: Python nao encontrado
pause
exit /b 1

:erro_node
echo ERRO: Node.js nao encontrado
pause
exit /b 1
