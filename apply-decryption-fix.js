#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

console.log('Aplicando patch para corrigir erro de descriptografia no Baileys...');

// Compila o TypeScript para Javascript
console.log('1. Compilando TypeScript para Javascript...');
exec('npx tsc', (error, stdout, stderr) => {
  if (error) {
    console.error(`Erro na compilação: ${error.message}`);
    return;
  }

  if (stderr) {
    console.error(`Aviso na compilação: ${stderr}`);
  }

  console.log(`Compilação concluída: ${stdout || 'Sem saída'}`);

  // Copia os arquivos necessários
  console.log('2. Copiando arquivos de patch...');

  try {
    // Verifica se o diretório lib/Utils existe, senão cria
    const utilsDir = path.join(__dirname, 'lib/Utils');
    if (!fs.existsSync(utilsDir)) {
      fs.mkdirSync(utilsDir, { recursive: true });
    }

    // Copia os arquivos necessários para a pasta lib
    fs.copyFileSync(
      path.join(__dirname, 'lib/Utils/fallback-decryption-fixed.js'),
      path.join(__dirname, 'lib/Utils/fallback-decryption-fixed.js')
    );

    fs.copyFileSync(
      path.join(__dirname, 'lib/Utils/enhanced-media.js'),
      path.join(__dirname, 'lib/Utils/enhanced-media.js')
    );

    // Cria arquivo index.patched.js
    fs.copyFileSync(
      path.join(__dirname, 'lib/index.patched.js'),
      path.join(__dirname, 'lib/index.patched.js')
    );

    console.log('3. Aplicando patch ao index.js principal...');

    // Adiciona o patch ao index.js principal
    const indexPath = path.join(__dirname, 'lib/index.js');
    let indexContent = fs.readFileSync(indexPath, 'utf8');

    // Verifica se o patch já foi aplicado
    if (!indexContent.includes('// PATCH: Importa solução para erro de descriptografia')) {
      const patchImport = `
// PATCH: Importa solução para erro de descriptografia
require('./index.patched');
`;

      indexContent = patchImport + indexContent;
      fs.writeFileSync(indexPath, indexContent);
    }

    console.log('✅ Patch aplicado com sucesso! O erro de descriptografia deve estar resolvido.');
  } catch (err) {
    console.error('❌ Erro ao aplicar o patch:', err);
  }
});
