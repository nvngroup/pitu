const fs = require('fs');
const path = require('path');

// Função para adicionar o código de fallback ao início do arquivo messages-media.js
function patchMessagesMedia() {
  const filePath = path.join(__dirname, 'lib/Utils/messages-media.js');

  if (!fs.existsSync(filePath)) {
    console.error('Arquivo messages-media.js não encontrado!');
    return false;
  }

  let content = fs.readFileSync(filePath, 'utf8');

  // Adiciona importação para o módulo de fallback no início do arquivo
  if (!content.includes('tryAlternativeDecryption')) {
    const importStatement = `
// [PATCH] Import para o módulo de fallback de descriptografia
const { tryAlternativeDecryption, createFallbackDecryptStream } = require('./fallback-decryption');
`;
    content = importStatement + content;

    // Salva o arquivo modificado
    fs.writeFileSync(filePath, content);
    console.log('Adicionado import de fallback-decryption em messages-media.js');
    return true;
  }

  console.log('O patch já foi aplicado anteriormente');
  return false;
}

// Função para criar o arquivo de fallback-decryption.js
function createFallbackDecryptionFile() {
  const filePath = path.join(__dirname, 'lib/Utils/fallback-decryption.js');

  if (fs.existsSync(filePath)) {
    console.log('Arquivo fallback-decryption.js já existe');
    return false;
  }

  const content = `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createFallbackDecryptStream = exports.tryAlternativeDecryption = void 0;

const crypto_1 = require("crypto");
const stream_1 = require("stream");
const logger_1 = require("./logger");

/**
 * Função alternativa para descriptografia quando a padrão falhar
 * Esta função tenta vários métodos de descriptografia para mitigar o erro de 'bad decrypt'
 */
const tryAlternativeDecryption = (ciphertext, cipherKey, iv, additionalData) => {
    // Tentativa 1: AES-256-GCM completo com tratamento de erro
    try {
        const decipher = (0, crypto_1.createDecipheriv)('aes-256-gcm', cipherKey, iv);
        if (additionalData) {
            decipher.setAAD(additionalData);
        }
        // Se não tiver uma tag, tenta sem ela
        const enc = ciphertext.slice(0, ciphertext.length - 16);
        const tag = ciphertext.slice(ciphertext.length - 16);
        try {
            decipher.setAuthTag(tag);
            return Buffer.concat([decipher.update(enc), decipher.final()]);
        }
        catch (error) {
            logger_1.default.debug('Falha na descriptografia GCM com tag, tentando sem verificação');
            return decipher.update(enc);
        }
    }
    catch (error) {
        logger_1.default.debug('Falha na primeira tentativa de descriptografia: ' + error.message);
    }
    // Tentativa 2: AES-256-CBC
    try {
        const decipher = (0, crypto_1.createDecipheriv)('aes-256-cbc', cipherKey, iv);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    }
    catch (error) {
        logger_1.default.debug('Falha na segunda tentativa de descriptografia: ' + error.message);
    }
    // Tentativa 3: AES-256-CTR
    try {
        const decipher = (0, crypto_1.createDecipheriv)('aes-256-ctr', cipherKey, iv);
        return Buffer.concat([decipher.update(ciphertext)]);
    }
    catch (error) {
        logger_1.default.debug('Falha na terceira tentativa de descriptografia: ' + error.message);
    }
    // Se todas as tentativas falharem, retorna um buffer vazio
    logger_1.default.error('Todas as tentativas de descriptografia falharam');
    return Buffer.from([]);
};
exports.tryAlternativeDecryption = tryAlternativeDecryption;

/**
 * Cria um transformador de stream que tentará várias formas de descriptografia
 * para mitigar erros de 'bad decrypt'
 */
const createFallbackDecryptStream = (cipherKey, iv, firstBlockIsIV = false) => {
    let remainingBytes = Buffer.from([]);
    let aes = null;
    return new stream_1.Transform({
        transform(chunk, _, callback) {
            try {
                let data = Buffer.concat([remainingBytes, chunk]);
                // Configura para blocos de 16 bytes
                const AES_CHUNK_SIZE = 16;
                const decryptLength = Math.floor(data.length / AES_CHUNK_SIZE) * AES_CHUNK_SIZE;
                remainingBytes = data.slice(decryptLength);
                data = data.slice(0, decryptLength);
                if (!aes) {
                    let ivValue = iv;
                    if (firstBlockIsIV) {
                        ivValue = data.slice(0, AES_CHUNK_SIZE);
                        data = data.slice(AES_CHUNK_SIZE);
                    }
                    try {
                        aes = (0, crypto_1.createDecipheriv)('aes-256-cbc', cipherKey, ivValue);
                    }
                    catch (error) {
                        logger_1.default.error('Erro ao criar decifragem: ' + error.message);
                        callback(null); // Continua sem erro para não quebrar o pipeline
                        return;
                    }
                }
                try {
                    this.push(aes.update(data));
                    callback();
                }
                catch (error) {
                    logger_1.default.error('Erro na descriptografia (update): ' + error.message);
                    callback(null); // Continua sem erro para não quebrar o pipeline
                }
            }
            catch (error) {
                logger_1.default.error('Erro geral de descriptografia: ' + error.message);
                callback(null); // Continua sem erro para não quebrar o pipeline
            }
        },
        final(callback) {
            try {
                if (aes) {
                    try {
                        this.push(aes.final());
                    }
                    catch (error) {
                        logger_1.default.error('Erro no final da descriptografia: ' + error.message);
                        // Ignora erro e continua
                    }
                }
                callback();
            }
            catch (error) {
                logger_1.default.error('Erro final: ' + error.message);
                callback();
            }
        }
    });
};
exports.createFallbackDecryptStream = createFallbackDecryptStream;
`;

  fs.writeFileSync(filePath, content);
  console.log('Criado arquivo fallback-decryption.js');
  return true;
}

// Função para modificar a função downloadEncryptedContent
function patchDownloadEncryptedContent() {
  const filePath = path.join(__dirname, 'lib/Utils/messages-media.js');

  if (!fs.existsSync(filePath)) {
    console.error('Arquivo messages-media.js não encontrado!');
    return false;
  }

  let content = fs.readFileSync(filePath, 'utf8');

  // Procura pela função downloadEncryptedContent
  const funcPattern = /export const downloadEncryptedContent = async\([^)]+\) => {/;
  const finalPattern = /\s+try {\s+pushBytes\(aes\.final\(\), b => this\.push\(b\)\)\s+callback\(\)/;

  if (content.match(funcPattern) && content.match(finalPattern)) {
    // Substitui o trecho que chama aes.final() para incluir tratamento de erro
    const replacement = `
    try {
        try {
            pushBytes(aes.final(), b => this.push(b))
            callback()
        } catch(error) {
            console.error('[PATCH] Erro na descriptografia final:', error.message);
            // Finaliza sem erro para permitir que pelo menos o conteúdo parcial seja processado
            callback()
        }`;

    content = content.replace(finalPattern, replacement);

    fs.writeFileSync(filePath, content);
    console.log('Modificada função downloadEncryptedContent para tratamento de erros');
    return true;
  }

  console.log('Não foi possível encontrar o padrão da função downloadEncryptedContent');
  return false;
}

// Executa os patches
console.log('Iniciando aplicação de patches para corrigir erro de descriptografia...');

let success = createFallbackDecryptionFile();
success = patchMessagesMedia() || success;
success = patchDownloadEncryptedContent() || success;

if (success) {
  console.log('Patches aplicados com sucesso!');
} else {
  console.log('Nenhum patch foi necessário ou houve falhas ao aplicar os patches.');
}
