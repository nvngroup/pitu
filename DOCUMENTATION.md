# Baileys Socket - Documentação

## Índice

- [Introdução](#introdução)
- [Visão Geral do Socket](#visão-geral-do-socket)
- [Eventos do Socket](#eventos-do-socket)
  - [connection.update](#connectionupdate)
  - [creds.update](#credsupdate)
  - [messaging-history.set](#messaging-historyset)
  - [chats.upsert](#chatsupsert)
  - [chats.update](#chatsupdate)
  - [chats.phoneNumberShare](#chatsphonenumbershare)
  - [chats.delete](#chatsdelete)
  - [presence.update](#presenceupdate)
  - [contacts.upsert](#contactsupsert)
  - [contacts.update](#contactsupdate)
  - [messages.delete](#messagesdelete)
  - [messages.update](#messagesupdate)
  - [messages.media-update](#messagesmedia-update)
  - [messages.upsert](#messagesupsert)
  - [messages.reaction](#messagesreaction)
  - [message-receipt.update](#message-receiptupdate)
  - [groups.upsert](#groupsupsert)
  - [groups.update](#groupsupdate)
  - [group-participants.update](#group-participantsupdate)
  - [group.join-request](#groupjoin-request)
  - [blocklist.set](#blocklistset)
  - [blocklist.update](#blocklistupdate)
  - [call](#call)
  - [labels.edit](#labelsedit)
  - [labels.association](#labelsassociation)
- [Autenticação e Sessão](#autenticação-e-sessão)
- [Configurações Padrões do Socket](#configurações-padrões-do-socket)
  - [patchMessageBeforeSending](#patchmessagebeforesending)
  - [shouldSyncHistoryMessage](#shouldsynchistorymessage)
  - [shouldIgnoreJid](#shouldignorejid)
  - [getMessage](#getmessage)
  - [cachedGroupMetadata](#cachedgroupmetadata)
  - [makeSignalRepository](#makesignalrepository)
- [Gerenciamento de Mensagens](#gerenciamento-de-mensagens)
  - [Enviando Mensagens](#enviando-mensagens)
  - [Funcionamento Interno do Gerenciamento de Mensagens](#funcionamento-interno-do-gerenciamento-de-mensagens)
    - [Geração e Envio de Mensagens](#1-gera%C3%A7%C3%A3o-e-envio-de-mensagens)
    - [Opções Especiais de Envio](#2-op%C3%A7%C3%B5es-especiais-de-envio)
    - [Envio para Grupos, Contatos e Status](#3-envio-para-grupos-contatos-e-status)
    - [Recibos de Leitura e Entrega](#4-recibos-de-leitura-e-entrega)
    - [Sincronização e Sessões](#5-sincroniza%C3%A7%C3%A3o-e-sess%C3%B5es)
    - [Boas Práticas e Observações](#6-boas-pr%C3%A1ticas-e-observa%C3%A7%C3%B5es)
- [Gerenciamento de Grupos](#gerenciamento-de-grupos)
  - [Buscar Metadados de um Grupo](#1-buscar-metadados-de-um-grupo)
  - [Criar um Grupo](#2-criar-um-grupo)
  - [Sair de um Grupo](#3-sair-de-um-grupo)
  - [Atualizar o Assunto do Grupo](#4-atualizar-o-assunto-do-grupo)
  - [Atualizar a Descrição do Grupo](#5-atualizar-a-descrição-do-grupo)
  - [Gerenciar Participantes](#6-gerenciar-participantes)
  - [Buscar Todos os Grupos Participantes](#7-buscar-todos-os-grupos-participantes)
  - [Gerenciar Convites](#8-gerenciar-convites)
  - [Modos e Configurações Avançadas](#9-modos-e-configurações-avançadas)
  - [Gerenciar Solicitações de Participação](#10-gerenciar-solicitações-de-participação)
  - [Eventos Relacionados a Grupos](#11-eventos-relacionados-a-grupos)
- [Gerenciamento de Chats](#gerenciamento-de-chats)
  - [Modificar um Chat (marcar como lido, arquivar, etc)](#1-modificar-um-chat-marcar-como-lido-arquivar-etc)
  - [Gerenciar Contatos](#2-gerenciar-contatos)
  - [Atualizar Foto, Nome e Status do Perfil](#3-atualizar-foto-nome-e-status-do-perfil)
  - [Gerenciar Labels (Etiquetas)](#4-gerenciar-labels-etiquetas)
  - [Gerenciar Privacidade](#5-gerenciar-privacidade)
  - [Gerenciar Modo Temporário (Mensagens que somem)](#6-gerenciar-modo-temporário-mensagens-que-somem)
  - [Consultar Lista de Contatos Bloqueados](#7-consultar-lista-de-contatos-bloqueados)
  - [Bloquear ou Desbloquear Contato](#8-bloquear-ou-desbloquear-contato)
  - [Consultar Perfil de Negócios](#9-consultar-perfil-de-negócios)
  - [Consultar Status, Bots e Modo Temporário de Contatos](#10-consultar-status-bots-e-modo-temporário-de-contatos)
  - [Eventos Relacionados a Chats](#11-eventos-relacionados-a-chats)
- [Mensagens de Negócios (Business)](#mensagens-de-negócios-business)
  - [Consultar Catálogo de Produtos](#1-consultar-catalogo-de-produtos)
  - [Consultar Coleções do Catálogo](#2-consultar-coleções-do-catalogo)
  - [Consultar Detalhes de Pedido](#3-consultar-detalhes-de-pedido)
  - [Criar Produto no Catálogo](#4-criar-produto-no-catalogo)
  - [Editar Produto do Catálogo](#5-editar-produto-do-catalogo)
  - [Deletar Produto(s) do Catálogo](#6-deletar-produto-s-do-catalogo)
- [Sincronização de Dados (USync)](#sincronização-de-dados-usync)
- [Utilitários do Socket](#utilitários-do-socket)

## Introdução

O Socket da Baileys permite a conexão direta com o WhatsApp Web via WebSocket, sem a necessidade de Selenium ou navegadores. Ele é altamente eficiente, consome menos memória e suporta múltiplos dispositivos.

## Visão Geral do Socket

O Socket da Baileys é o núcleo responsável pela comunicação em tempo real com o WhatsApp Web, utilizando o protocolo WebSocket. Ele abstrai toda a complexidade de conexão, autenticação, envio e recebimento de eventos e mensagens, permitindo que desenvolvedores criem integrações robustas e escaláveis com a plataforma WhatsApp.

Principais características:

- **Conexão Direta:** Utiliza WebSocket para comunicação eficiente, sem a necessidade de navegadores ou Selenium.
- **Multi-dispositivo:** Suporta autenticação e uso em múltiplos dispositivos, seguindo o padrão do WhatsApp Web.
- **Gerenciamento de Sessão:** Permite salvar e restaurar sessões, evitando a necessidade de autenticação recorrente.
- **Eventos em Tempo Real:** Emite eventos para todas as ações relevantes, como recebimento de mensagens, atualizações de chats, grupos, presença, entre outros.
- **Envio e Recebimento de Mensagens:** Suporte completo a mensagens de texto, mídia, reações, listas, enquetes, entre outros formatos.
- **Gerenciamento de Grupos e Contatos:** Permite criar, editar, gerenciar grupos e contatos de forma programática.
- **Extensível:** Estrutura modular, facilitando a adição de novas funcionalidades e integrações.

O Socket é a base para todas as operações do Baileys, sendo fundamental para qualquer aplicação que deseje interagir com o WhatsApp de forma automatizada e confiável.

## Eventos do Socket

O `BaileysEventMap` define todos os eventos que podem ser emitidos pelo Socket da Baileys. Cada evento representa uma ação ou atualização relevante durante a comunicação com o WhatsApp. Abaixo, explico cada um dos principais eventos:

### connection.update
Atualização do estado da conexão WebSocket (aberta, fechada, conectando, etc). Permite monitorar a saúde da conexão e reagir a quedas ou reconexões.

Escute atualizações de conexão:
```ts
sock.ev.on('connection.update', (update) => {
    if (update.connection === 'open') {
        console.log('Conectado ao WhatsApp!')
    } else if (update.connection === 'close') {
        console.log('Conexão encerrada:', update.lastDisconnect?.error)
    }
})
```

### creds.update
Atualização das credenciais de autenticação. Importante para persistir dados de sessão e evitar a necessidade de novo login.

Salve as credenciais sempre que forem atualizadas:
```ts
sock.ev.on('creds.update', (creds) => {
    saveCreds(creds)
})
```

### messaging-history.set
Sincronização do histórico de chats, contatos e mensagens. Usado ao restaurar sessões ou sincronizar dados antigos.
- `chats`: Lista de chats sincronizados
- `contacts`: Lista de contatos
- `messages`: Mensagens sincronizadas
- `isLatest`: Indica se é o histórico mais recente
- `progress`: Progresso da sincronização
- `syncType`: Tipo de sincronização
- `peerDataRequestSessionId`: ID de sessão de requisição

Receba o histórico de chats, contatos e mensagens:
```ts
sock.ev.on('messaging-history.set', (data) => {
    console.log('Histórico sincronizado:', data)
})
```

### chats.upsert
Inserção de novos chats detectados.

Detecte novos chats:
```ts
sock.ev.on('chats.upsert', (chats) => {
    chats.forEach(chat => console.log('Novo chat:', chat))
})
```

### chats.update
Atualização de chats existentes (ex: nome, status, etc).

Atualizações em chats:
```ts
sock.ev.on('chats.update', (updates) => {
    updates.forEach(update => console.log('Chat atualizado:', update))
})
```

### chats.phoneNumberShare
Evento de compartilhamento de número de telefone em um chat.

Compartilhamento de número:
```ts
sock.ev.on('chats.phoneNumberShare', (data) => {
    console.log('Número compartilhado:', data)
})
```

### chats.delete
Exclusão de chats pelo ID.

Exclusão de chats:
```ts
sock.ev.on('chats.delete', (ids) => {
    console.log('Chats excluídos:', ids)
})
```

### presence.update
Atualização da presença (online, digitando, etc) de contatos em um chat.

Mudança de presença:
```ts
sock.ev.on('presence.update', (data) => {
    console.log('Presença atualizada:', data)
})
```

### contacts.upsert
Inserção de novos contatos.

Novos contatos:
```ts
sock.ev.on('contacts.upsert', (contacts) => {
    contacts.forEach(contact => console.log('Novo contato:', contact))
})
```

### contacts.update
Atualização de contatos existentes.

Atualização de contatos:
```ts
sock.ev.on('contacts.update', (updates) => {
    updates.forEach(update => console.log('Contato atualizado:', update))
})
```

### messages.delete
Exclusão de mensagens. Pode ser por chave(s) específica(s) ou todas de um chat.

Exclusão de mensagens:
```ts
sock.ev.on('messages.delete', (info) => {
    console.log('Mensagens excluídas:', info)
})
```

### messages.update
Atualização de mensagens (ex: edição, status de entrega, etc).

Atualização de mensagens:
```ts
sock.ev.on('messages.update', (updates) => {
    updates.forEach(update => console.log('Mensagem atualizada:', update))
})
```

### messages.media-update
Atualização de mídia em mensagens (download, upload, erro, etc).

Atualização de mídia:
```ts
sock.ev.on('messages.media-update', (medias) => {
    medias.forEach(media => console.log('Mídia atualizada:', media))
})
```

### messages.upsert
Inserção de novas mensagens (recebidas ou enviadas). Inclui tipo (notify, append, etc) e, opcionalmente, um requestId.

Novas mensagens:
```ts
sock.ev.on('messages.upsert', ({ messages, type }) => {
    messages.forEach(msg => console.log('Nova mensagem:', msg))
})
```

### messages.reaction
Reação a mensagens (ex: emoji). Se a reação for removida, o campo `reaction.text` será vazio.

Reações em mensagens:
```ts
sock.ev.on('messages.reaction', (reactions) => {
    reactions.forEach(reaction => console.log('Reação:', reaction))
})
```

### message-receipt.update
Atualização dos recibos de mensagens (entregue, lido, etc).

Recibos de mensagens:
```ts
sock.ev.on('message-receipt.update', (receipts) => {
    receipts.forEach(receipt => console.log('Recibo:', receipt))
})
```

### groups.upsert
Inserção de novos grupos.

Novos grupos:
```ts
sock.ev.on('groups.upsert', (groups) => {
    groups.forEach(group => console.log('Novo grupo:', group))
})
```

### groups.update
Atualização de grupos existentes.

Atualização de grupos:
```ts
sock.ev.on('groups.update', (updates) => {
    updates.forEach(update => console.log('Grupo atualizado:', update))
})
```

### group-participants.update
Ação em participantes de grupo (adicionar, remover, promover, etc).
- `id`: ID do grupo
- `author`: Quem executou a ação
- `participants`: Participantes afetados
- `action`: Tipo de ação

Mudança em participantes de grupo:
```ts
sock.ev.on('group-participants.update', (data) => {
    console.log('Participantes do grupo atualizados:', data)
})
```

### group.join-request
Solicitação de entrada em grupo, incluindo método e ação tomada.

Solicitação de entrada em grupo:
```ts
sock.ev.on('group.join-request', (data) => {
    console.log('Solicitação de entrada em grupo:', data)
})
```

### blocklist.set
Definição da lista de contatos bloqueados.

Definição da lista de bloqueados:
```ts
sock.ev.on('blocklist.set', (data) => {
    console.log('Blocklist definida:', data)
})
```

### blocklist.update
Atualização da lista de bloqueados (adição ou remoção).

Atualização da blocklist:
```ts
sock.ev.on('blocklist.update', (data) => {
    console.log('Blocklist atualizada:', data)
})
```

### call
Atualização sobre chamadas (recebida, rejeitada, aceita, etc).

Atualização de chamadas:
```ts
sock.ev.on('call', (calls) => {
    calls.forEach(call => console.log('Chamada:', call))
})
```

### labels.edit
Edição de etiquetas (labels) para organização de chats/mensagens.

Edição de etiquetas:
```ts
sock.ev.on('labels.edit', (label) => {
    console.log('Etiqueta editada:', label)
})
```

### labels.association
Associação ou remoção de etiquetas em chats ou mensagens.

Associação de etiquetas:
```ts
sock.ev.on('labels.association', (data) => {
    console.log('Associação de etiqueta:', data)
})
```

## Autenticação e Sessão

A autenticação e o gerenciamento de sessão são fundamentais para garantir que sua aplicação mantenha o acesso ao WhatsApp sem a necessidade de escanear o QR Code a cada execução. O Baileys facilita esse processo através do método `makeWASocket` e utilitários de persistência de credenciais.

### Criando o Socket com makeWASocket

O `makeWASocket` é a função principal para inicializar a conexão com o WhatsApp Web. Ela aceita diversas opções de configuração, incluindo o estado de autenticação.

#### Exemplo básico de conexão:
```ts
import makeWASocket from 'baileys'

const sock = makeWASocket({
    printQRInTerminal: true // Exibe o QR Code no terminal para autenticação
})
```

### Salvando e Restaurando Sessão

Para evitar a necessidade de autenticação manual toda vez, utilize o utilitário `useMultiFileAuthState` para salvar e restaurar as credenciais:

```ts
import makeWASocket, { useMultiFileAuthState } from 'baileys'

async function iniciarSocket() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys')
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true
    })
    sock.ev.on('creds.update', saveCreds)
}

iniciarSocket()
```

- O método `useMultiFileAuthState` armazena as credenciais em arquivos, facilitando a persistência entre execuções.
- O evento `creds.update` deve ser escutado para salvar automaticamente as credenciais sempre que houver alteração.

### Observações
- Sempre salve as credenciais após qualquer atualização para evitar perda de sessão.
- O diretório passado para `useMultiFileAuthState` pode ser personalizado conforme sua necessidade.
- Para produção, recomenda-se armazenar as credenciais em local seguro e, se possível, criptografado.

## Configurações Padrões do Socket

O Baileys oferece uma configuração padrão para o Socket, definida em `DEFAULT_CONNECTION_CONFIG`. Essas opções controlam o comportamento da conexão, autenticação, performance e recursos avançados. Você pode sobrescrever qualquer uma delas ao criar o socket com `makeWASocket`.

### Principais Opções Padrão

- **version**: Versão do protocolo WhatsApp Web utilizada.
- **browser**: Identificação do navegador emulado (ex: Ubuntu/Chrome).
- **waWebSocketUrl**: URL do WebSocket do WhatsApp Web.
- **connectTimeoutMs**: Tempo máximo (ms) para tentar conectar.
- **keepAliveIntervalMs**: Intervalo (ms) para envio de pacotes keep-alive.
- **logger**: Logger padrão para logs do Baileys.
- **emitOwnEvents**: Se eventos próprios devem ser emitidos.
- **defaultQueryTimeoutMs**: Timeout padrão para queries (ms).
- **customUploadHosts**: Hosts customizados para upload de mídia.
- **retryRequestDelayMs**: Delay entre tentativas de requisição (ms).
- **maxMsgRetryCount**: Máximo de tentativas para reenviar mensagens.
- **fireInitQueries**: Se deve disparar queries iniciais ao conectar.
- **auth**: Estado de autenticação (deve ser preenchido pelo usuário).
- **markOnlineOnConnect**: Se o status deve ser marcado como online ao conectar.
- **syncFullHistory**: Se deve sincronizar todo o histórico de mensagens.
- **patchMessageBeforeSending**: Função para modificar mensagens antes do envio.
- **shouldSyncHistoryMessage**: Função para decidir se deve sincronizar mensagens históricas.
- **shouldIgnoreJid**: Função para ignorar JIDs específicos.
- **linkPreviewImageThumbnailWidth**: Largura da miniatura de preview de link.
- **transactionOpts**: Opções para transações internas (retries, delays).
- **generateHighQualityLinkPreview**: Gera previews de link em alta qualidade.
- **options**: Objeto para configurações adicionais.
- **appStateMacVerification**: Verificação de integridade de estado do app.
- **countryCode**: Código do país padrão (ex: 'US').
- **getMessage**: Função para buscar mensagens do armazenamento local.
- **cachedGroupMetadata**: Função para cache de metadados de grupos.
- **makeSignalRepository**: Função para criar o repositório Signal (criptografia).

### Exemplo de uso customizando configurações

```ts
const sock = makeWASocket({
    printQRInTerminal: true,
    browser: Browsers.macOS('Safari'), // Emula Safari/macOS
    markOnlineOnConnect: false, // Não marca online ao conectar
    syncFullHistory: true, // Sincroniza todo o histórico
    countryCode: 'BR', // Define o país padrão como Brasil
    logger: customLogger // Logger customizado
})
```

Você pode sobrescrever apenas as opções que desejar, mantendo o restante das configurações padrão.

> Consulte a tipagem `SocketConfig` para ver todas as opções disponíveis e suas descrições detalhadas.

### patchMessageBeforeSending

A opção `patchMessageBeforeSending` permite que você modifique ou ajuste uma mensagem antes dela ser enviada ao WhatsApp. Essa função recebe o objeto da mensagem como parâmetro e deve retornar a mensagem (possivelmente alterada). É útil para adicionar, remover ou transformar campos dinamicamente, como inserir metadados, corrigir formatação ou aplicar regras de negócio específicas.

#### Exemplo de uso:
```ts
const sock = makeWASocket({
    patchMessageBeforeSending: (msg) => {
        // Exemplo: adiciona uma tag customizada em todas as mensagens de texto
        if (msg.text) {
            msg.text = '[BOT] ' + msg.text
        }
        return msg
    }
})
```

Você pode usar essa função para:
- Adicionar prefixos ou sufixos em mensagens
- Injetar informações extras (ex: IDs, marcações)
- Corrigir ou padronizar campos antes do envio
- Aplicar filtros de conteúdo

Se não precisar modificar nada, basta retornar a própria mensagem recebida.

> Dica: Use com cautela para não gerar mensagens incompatíveis com o protocolo do WhatsApp.

### shouldSyncHistoryMessage

A função `shouldSyncHistoryMessage` permite que você controle, de forma programática, se uma mensagem histórica (mensagens antigas recuperadas durante a sincronização) deve ser sincronizada ou ignorada pelo Baileys. Ela recebe como parâmetro a mensagem e deve retornar `true` (para sincronizar) ou `false` (para ignorar).

Essa função é útil para filtrar mensagens antigas, por exemplo, ignorando mensagens de determinados tipos, grupos ou contatos durante a restauração do histórico.

#### Exemplo de uso:
```ts
const sock = makeWASocket({
    shouldSyncHistoryMessage: (msg) => {
        // Exemplo: ignora mensagens de grupos específicos
        if (msg.key.remoteJid?.endsWith('@g.us')) {
            return false // não sincroniza mensagens de grupos
        }
        return true // sincroniza todas as outras
    }
})
```

Você pode usar essa função para:
- Sincronizar apenas mensagens de contatos específicos
- Ignorar mensagens de grupos, canais ou bots
- Filtrar mensagens por tipo (texto, mídia, etc)
- Reduzir o volume de dados sincronizados em grandes históricos

Se não for definida, o padrão é sincronizar todas as mensagens históricas (`true`).

### shouldIgnoreJid

A função `shouldIgnoreJid` permite que você defina, de forma programática, quais JIDs (identificadores de usuários, grupos, canais, etc) devem ser ignorados pelo Baileys durante a sincronização e o processamento de eventos/mensagens. Ela recebe o JID como parâmetro e deve retornar `true` (para ignorar) ou `false` (para processar normalmente).

Essa função é útil para filtrar grupos, contatos, canais ou qualquer JID que você não queira que o seu bot/processo interaja ou processe.

#### Exemplo de uso:
```ts
const sock = makeWASocket({
    shouldIgnoreJid: (jid) => {
        // Exemplo: ignora todos os grupos
        if (jid.endsWith('@g.us')) {
            return true // ignora grupos
        }
        // Exemplo: ignora um contato específico
        if (jid === '123456789@s.whatsapp.net') {
            return true
        }
        return false // processa todos os outros
    }
})
```

Você pode usar essa função para:
- Ignorar grupos, canais ou contatos específicos
- Bloquear interações com determinados JIDs
- Reduzir o processamento de eventos indesejados

Se não for definida, o padrão é processar todos os JIDs (`false`).

### getMessage

A função `getMessage` é utilizada para buscar e retornar uma mensagem específica do armazenamento local da sua aplicação, a partir de um identificador (geralmente o `WAMessageKey`).

Ela é fundamental para cenários em que o Baileys precisa acessar o conteúdo completo de uma mensagem já recebida ou enviada anteriormente, como ao reenviar, editar, deletar ou processar reações e recibos de leitura.

Essa função deve ser assíncrona e retornar a mensagem correspondente ao identificador fornecido, ou `undefined` caso não seja encontrada.

#### Exemplo de uso:
```ts
const sock = makeWASocket({
    getMessage: async (key) => {
        // Exemplo: busca a mensagem em um banco de dados local ou cache
        return await buscarMensagemNoBanco(key.id)
    }
})
```

Você pode usar essa função para:
- Permitir que o Baileys recupere mensagens antigas para operações como deleção, edição, citação
- Integrar com bancos de dados, caches ou sistemas de persistência próprios
- Garantir que operações dependentes de mensagens anteriores funcionem corretamente

Se não for definida, o padrão é retornar `undefined`, o que pode limitar algumas funcionalidades do Baileys.

> Dica: Implemente um sistema de armazenamento eficiente para garantir performance e integridade ao buscar mensagens por chave.

### cachedGroupMetadata

A função `cachedGroupMetadata` permite que você forneça ao Baileys um mecanismo de cache para os metadados de grupos (como nome, participantes, descrição, configurações, etc). Ela é chamada sempre que o socket precisa acessar informações detalhadas de um grupo, evitando múltiplas requisições à API do WhatsApp e melhorando a performance da aplicação.

Essa função deve ser assíncrona e receber o JID do grupo como parâmetro, retornando os metadados do grupo (caso estejam em cache) ou `undefined` caso não estejam disponíveis localmente.

#### Exemplo de uso:
```ts
const sock = makeWASocket({
    cachedGroupMetadata: async (jid) => {
        // Exemplo: busca os metadados do grupo em um banco de dados ou cache local
        return await buscarMetadadosDoGrupoNoCache(jid)
    }
})
```

Você pode usar essa função para:
- Reduzir chamadas repetidas à API do WhatsApp para grupos já conhecidos
- Integrar com bancos de dados, Redis, ou outros sistemas de cache
- Melhorar a performance e escalabilidade de bots que interagem com muitos grupos

Se não for definida, o padrão é não utilizar cache, fazendo uma nova requisição sempre que necessário.

> Dica: Mantenha o cache atualizado sempre que houver eventos de atualização de grupos para garantir informações consistentes.

### makeSignalRepository

A função `makeSignalRepository` é responsável por criar e fornecer o repositório Signal utilizado pelo Baileys para gerenciar toda a criptografia ponta-a-ponta das mensagens, grupos e chamadas. O Signal Protocol é o padrão de segurança utilizado pelo WhatsApp para garantir privacidade e integridade das comunicações.

Essa função deve retornar uma implementação compatível com o Signal Protocol, responsável por armazenar e recuperar chaves, sessões e outros dados criptográficos necessários para o funcionamento seguro do socket.

Na maioria dos casos, o Baileys já fornece uma implementação padrão (`makeLibSignalRepository`), mas você pode customizar para integrar com bancos de dados, sistemas distribuídos ou soluções de alta disponibilidade.

#### Exemplo de uso:
```ts
const sock = makeWASocket({
    makeSignalRepository: makeLibSignalRepository // padrão do Baileys
})
```

Você pode customizar essa função para:
- Integrar o armazenamento de chaves com bancos de dados externos
- Implementar estratégias de backup e recuperação de sessões Signal
- Garantir alta disponibilidade e resiliência em ambientes distribuídos

Se não for definida, o padrão é utilizar a implementação interna do Baileys, que já atende à maioria dos casos de uso.

> Dica: Só altere essa função se você realmente precisar de controle avançado sobre o armazenamento das chaves Signal. Para a maioria dos bots e integrações, a implementação padrão é suficiente e segura.

## Gerenciamento de Mensagens

O gerenciamento de mensagens é um dos principais recursos do Socket Baileys, permitindo enviar, editar, deletar, citar, reagir e baixar mídias de forma programática. Abaixo estão as operações mais comuns, exemplos práticos e dicas de uso.

### Enviando Mensagens

Para enviar mensagens, utilize o método `sock.sendMessage`. Ele aceita o JID do destinatário e o conteúdo da mensagem (texto, mídia, botões, listas, enquetes, entre outros).

#### Exemplo: Enviando mensagem de texto
```ts
await sock.sendMessage('5511999999999@s.whatsapp.net', { text: 'Olá, mundo!' })
```

#### Exemplo: Enviando imagem
```ts
await sock.sendMessage('5511999999999@s.whatsapp.net', {
    image: { url: './Media/cat.jpeg' },
    caption: 'Veja este gato!'
})
```

#### Exemplo: Enviando áudio
```ts
await sock.sendMessage('5511999999999@s.whatsapp.net', {
    audio: { url: './Media/sonata.mp3' },
    mimetype: 'audio/mp4',
    ptt: true // envia como áudio de voz
})
```

#### Observações
- O JID pode ser de contato, grupo ou broadcast.
- Para mídia, use `{ url: 'caminho/arquivo' }` ou buffer.
- O método retorna o objeto da mensagem enviada, incluindo o `key` (usado para edição, deleção, citação, etc).

### Funcionamento Interno do Gerenciamento de Mensagens

O método `sendMessage` do Baileys é altamente robusto e flexível, permitindo o envio de mensagens para contatos, grupos, status e até operações avançadas como edição, deleção, pin, enquetes e mais. Abaixo, detalho como o gerenciamento de mensagens funciona internamente, com base no código-fonte (`src/Socket/messages-send.ts`).

#### 1. Geração e Envio de Mensagens
- O método `sendMessage` prepara a mensagem usando `generateWAMessage`, que monta o conteúdo conforme o tipo (texto, mídia, botões, etc) e aplica as opções fornecidas.
- Antes do envio, a mensagem pode ser modificada pela função `patchMessageBeforeSending` (útil para customizações globais).
- O envio real é feito por `relayMessage`, que cuida da criptografia, distribuição para múltiplos dispositivos e participantes (em grupos), e montagem dos atributos especiais (edição, deleção, pin, etc).
- O método retorna o objeto completo da mensagem enviada, incluindo o `key` (usado para edição, deleção, citação, etc).

#### 2. Opções Especiais de Envio
- **Edição:** Ao passar `{ edit: keyDaMensagem }` nas opções, a mensagem será editada (se permitido pelo WhatsApp).
- **Deleção:** Ao passar `{ delete: keyDaMensagem }`, a mensagem será deletada para todos os participantes possíveis.
- **Pin:** Ao passar `{ pin: true }`, a mensagem será fixada no chat (se suportado).
- **Enquetes:** O envio de enquetes é tratado de forma especial, adicionando metadados específicos.

#### 3. Envio para Grupos, Contatos e Status
- O Baileys detecta automaticamente se o JID é de grupo, contato ou status, e ajusta o envio conforme necessário.
- Para grupos, cuida da distribuição para todos os participantes e da gestão de chaves de criptografia (Signal Protocol).
- Para status, utiliza o JID especial `status@broadcast`.

#### 4. Recibos de Leitura e Entrega
- O método `readMessages` permite marcar mensagens como lidas, respeitando as configurações de privacidade do usuário.
- O método `sendReceipt` permite enviar recibos customizados (leitura, entrega, etc) para mensagens específicas.
- O método `sendReceipts` permite enviar recibos em massa para múltiplas mensagens/chats.

#### 5. Sincronização e Sessões
- O Baileys gerencia automaticamente sessões e dispositivos, garantindo que as mensagens sejam entregues a todos os dispositivos do destinatário (multi-dispositivo).
- Utiliza cache e sincronização para otimizar o envio e evitar redundâncias.

#### 6. Boas Práticas e Observações
- Sempre utilize o retorno de `sendMessage` para armazenar o objeto da mensagem, facilitando futuras operações (edição, deleção, citação, etc).
- Para operações em massa (ex: marcar várias mensagens como lidas), utilize os métodos de bulk (`readMessages`, `sendReceipts`).
- O envio para grupos é mais complexo devido à necessidade de distribuir chaves e garantir a entrega para todos os participantes.
- O Baileys cuida automaticamente da criptografia ponta-a-ponta, mas é importante manter o armazenamento de sessões e chaves seguro.
- Utilize os eventos do socket (`messages.upsert`, `messages.update`, etc) para monitorar o status das mensagens e atualizar seu sistema em tempo real.

#### 7. Exemplo Avançado: Enviando, Editando e Deletando
```ts
// Enviando uma mensagem e depois editando e deletando
const msg = await sock.sendMessage(jid, { text: 'Mensagem original' })

// Editando a mensagem
await sock.sendMessage(jid, { text: 'Mensagem editada' }, { edit: msg.key })

// Deletando a mensagem
await sock.sendMessage(jid, { delete: msg.key })
```

#### 8. Exemplo: Marcar várias mensagens como lidas
```ts
// Supondo que você tenha um array de WAMessageKey
await sock.readMessages([key1, key2, key3])
```

#### 9. Exemplo: Envio para grupo com citação
```ts
// Respondendo uma mensagem em grupo
await sock.sendMessage(grupoJid, { text: 'Olá, grupo!' }, { quoted: mensagemOriginal })
```

## Gerenciamento de Grupos

O Baileys oferece uma API completa para gerenciamento de grupos do WhatsApp, permitindo criar, editar, buscar informações, gerenciar participantes e controlar configurações avançadas de grupos. Todas as operações são realizadas de forma assíncrona e seguem o padrão de eventos e métodos do socket.

### Principais Métodos

#### 1. Buscar Metadados de um Grupo

```ts
const metadata = await sock.groupMetadata(jid)
```
Retorna informações detalhadas do grupo, como nome, participantes, descrição, configurações, etc.

#### 2. Criar um Grupo

```ts
const metadata = await sock.groupCreate('Nome do Grupo', ['jid1@s.whatsapp.net', 'jid2@s.whatsapp.net'])
```
Cria um novo grupo com o nome e participantes informados.

#### 3. Sair de um Grupo

```ts
await sock.groupLeave('id-do-grupo@g.us')
```
Remove o usuário atual do grupo.

#### 4. Atualizar o Assunto do Grupo

```ts
await sock.groupUpdateSubject('id-do-grupo@g.us', 'Novo Assunto')
```
Altera o nome/assunto do grupo.

#### 5. Atualizar a Descrição do Grupo

```ts
await sock.groupUpdateDescription('id-do-grupo@g.us', 'Nova descrição')
```
Altera a descrição do grupo. Para remover, basta passar `undefined` como descrição.

#### 6. Gerenciar Participantes

Adicionar, remover, promover ou rebaixar participantes:

```ts
await sock.groupParticipantsUpdate('id-do-grupo@g.us', ['jid@s.whatsapp.net'], 'add')      // Adicionar
await sock.groupParticipantsUpdate('id-do-grupo@g.us', ['jid@s.whatsapp.net'], 'remove')   // Remover
await sock.groupParticipantsUpdate('id-do-grupo@g.us', ['jid@s.whatsapp.net'], 'promote')  // Tornar admin
await sock.groupParticipantsUpdate('id-do-grupo@g.us', ['jid@s.whatsapp.net'], 'demote')   // Remover admin
```

#### 7. Buscar Todos os Grupos Participantes

```ts
const grupos = await sock.groupFetchAllParticipating()
```
Retorna um objeto com todos os grupos em que o usuário está participando.

#### 8. Gerenciar Convites

- **Obter código de convite:**
  ```ts
  const code = await sock.groupInviteCode('id-do-grupo@g.us')
  ```
- **Revogar código de convite:**
  ```ts
  const novoCode = await sock.groupRevokeInvite('id-do-grupo@g.us')
  ```
- **Aceitar convite por código:**
  ```ts
  const groupJid = await sock.groupAcceptInvite('codigo')
  ```

#### 9. Modos e Configurações Avançadas

- **Ativar/desativar mensagens temporárias:**
  ```ts
  await sock.groupToggleEphemeral('id-do-grupo@g.us', 86400) // 24h em segundos
  ```
- **Definir grupo como somente admins:**
  ```ts
  await sock.groupSettingUpdate('id-do-grupo@g.us', 'announcement')
  ```
- **Desbloquear grupo para todos:**
  ```ts
  await sock.groupSettingUpdate('id-do-grupo@g.us', 'not_announcement')
  ```
- **Ativar/desativar aprovação de entrada:**
  ```ts
  await sock.groupJoinApprovalMode('id-do-grupo@g.us', 'on')
  await sock.groupJoinApprovalMode('id-do-grupo@g.us', 'off')
  ```

#### 10. Gerenciar Solicitações de Participação

- **Listar solicitações pendentes:**
  ```ts
  const requests = await sock.groupRequestParticipantsList('id-do-grupo@g.us')
  ```
- **Aprovar ou rejeitar solicitações:**
  ```ts
  await sock.groupRequestParticipantsUpdate('id-do-grupo@g.us', ['jid@s.whatsapp.net'], 'approve')
  await sock.groupRequestParticipantsUpdate('id-do-grupo@g.us', ['jid@s.whatsapp.net'], 'reject')
  ```

#### 11. Eventos Relacionados a Grupos

- `groups.upsert`: Novos grupos detectados.
- `groups.update`: Atualizações em grupos existentes.
- `group-participants.update`: Mudanças em participantes (adição, remoção, promoção, etc).
- `group.join-request`: Solicitações de entrada em grupo.

Exemplo de escuta de eventos:
```ts
sock.ev.on('groups.update', (updates) => {
    updates.forEach(update => console.log('Grupo atualizado:', update))
})
```

### Observações

- Todos os métodos retornam Promises e devem ser usados com `await` ou `.then()`.
- Os métodos aceitam JIDs no formato padrão do WhatsApp (`@g.us` para grupos).
- Consulte a tipagem `GroupMetadata` para detalhes dos campos retornados.

## Gerenciamento de Chats

O Baileys permite o gerenciamento completo dos chats (conversas) do WhatsApp, incluindo criação, edição, arquivamento, marcação como lido/não lido, gerenciamento de contatos, labels e privacidade. Abaixo estão os principais métodos e exemplos de uso.

### Principais Métodos

#### 1. Modificar um Chat (marcar como lido, arquivar, etc)

```ts
// Marcar como lido
await sock.chatModify({ markRead: true }, 'jid-do-chat@s.whatsapp.net')

// Arquivar
await sock.chatModify({ archive: true }, 'jid-do-chat@s.whatsapp.net')
```

#### 2. Gerenciar Contatos

```ts
// Adicionar ou editar contato
await sock.addOrEditContact('jid@s.whatsapp.net', { notify: 'Nome do Contato' })

// Remover contato
await sock.removeContact('jid@s.whatsapp.net')
```

#### 3. Atualizar Foto, Nome e Status do Perfil

```ts
// Atualizar foto do perfil
await sock.updateProfilePicture('jid@s.whatsapp.net', { url: './Media/cat.jpeg' })

// Remover foto do perfil
await sock.removeProfilePicture('jid@s.whatsapp.net')

// Atualizar nome do perfil
await sock.updateProfileName('Novo Nome')

// Atualizar status do perfil
await sock.updateProfileStatus('Novo status!')
```

#### 4. Gerenciar Labels (Etiquetas)

```ts
// Adicionar label a um chat
await sock.addChatLabel('jid@s.whatsapp.net', 'id-da-label')

// Remover label de um chat
await sock.removeChatLabel('jid@s.whatsapp.net', 'id-da-label')

// Adicionar label a uma mensagem
await sock.addMessageLabel('jid@s.whatsapp.net', 'id-da-mensagem', 'id-da-label')

// Remover label de uma mensagem
await sock.removeMessageLabel('jid@s.whatsapp.net', 'id-da-mensagem', 'id-da-label')
```

#### 5. Gerenciar Privacidade

```ts
// Atualizar privacidade de mensagens
await sock.updateMessagesPrivacy('contacts') // ou 'everyone', 'nobody'

// Atualizar privacidade de chamadas
await sock.updateCallPrivacy('contacts')

// Atualizar privacidade do visto por último
await sock.updateLastSeenPrivacy('nobody')

// Atualizar privacidade do online
await sock.updateOnlinePrivacy('everyone')

// Atualizar privacidade da foto do perfil
await sock.updateProfilePicturePrivacy('contacts')

// Atualizar privacidade do status
await sock.updateStatusPrivacy('contacts')

// Atualizar privacidade dos recibos de leitura
await sock.updateReadReceiptsPrivacy('everyone')

// Atualizar quem pode adicionar em grupos
await sock.updateGroupsAddPrivacy('contacts')
```

#### 6. Gerenciar Modo Temporário (Mensagens que somem)

```ts
// Definir duração padrão para mensagens temporárias (em segundos)
await sock.updateDefaultDisappearingMode(86400) // 24h
```

#### 7. Consultar Lista de Contatos Bloqueados

```ts
const bloqueados = await sock.fetchBlocklist()
```

#### 8. Bloquear ou Desbloquear Contato

```ts
await sock.updateBlockStatus('jid@s.whatsapp.net', 'block')
await sock.updateBlockStatus('jid@s.whatsapp.net', 'unblock')
```

#### 9. Consultar Perfil de Negócios

```ts
const perfil = await sock.getBusinessProfile('jid@s.whatsapp.net')
```

#### 10. Consultar Status, Bots e Modo Temporário de Contatos

```ts
const status = await sock.fetchStatus('jid@s.whatsapp.net')
const bots = await sock.getBotListV2()
const modoTemp = await sock.fetchDisappearingDuration('jid@s.whatsapp.net')
```

#### 11. Eventos Relacionados a Chats

- `chats.upsert`: Novos chats detectados.
- `chats.update`: Atualizações em chats existentes.
- `chats.delete`: Exclusão de chats.
- `presence.update`: Mudança de presença (online, digitando, etc).
- `contacts.upsert`: Novos contatos.
- `contacts.update`: Atualização de contatos.

Exemplo de escuta de eventos:
```ts
sock.ev.on('chats.update', (updates) => {
    updates.forEach(update => console.log('Chat atualizado:', update))
})
```

### Observações

- Todos os métodos retornam Promises e devem ser usados com `await` ou `.then()`.
- Os métodos aceitam JIDs no formato padrão do WhatsApp (`@s.whatsapp.net` para contatos, `@g.us` para grupos).
- Consulte a tipagem `ChatModification` e demais tipos em `src/Types` para detalhes dos campos aceitos.

## Mensagens de Negócios (Business)

O Baileys oferece suporte completo ao gerenciamento de recursos de negócios do WhatsApp, como catálogo de produtos, coleções e pedidos. Abaixo estão os principais métodos disponíveis para contas comerciais:

### Principais Métodos

#### 1. Consultar Catálogo de Produtos

```ts
const catalogo = await sock.getCatalog({ jid: 'jid@whatsapp.net', limit: 10, cursor: '...' })
```
Retorna o catálogo de produtos da conta business. Permite paginação via `limit` e `cursor`.

#### 2. Consultar Coleções do Catálogo

```ts
const colecoes = await sock.getCollections('jid@whatsapp.net', 20)
```
Retorna as coleções de produtos cadastradas na conta business.

#### 3. Consultar Detalhes de Pedido

```ts
const detalhes = await sock.getOrderDetails('orderId', 'tokenBase64')
```
Retorna os detalhes de um pedido realizado no catálogo business.

#### 4. Criar Produto no Catálogo

```ts
const produto = await sock.productCreate({
  name: 'Produto Exemplo',
  price: 1000, // em centavos
  currency: 'BRL',
  ...outrosCampos
})
```
Cria um novo produto no catálogo da conta business.

#### 5. Editar Produto do Catálogo

```ts
const produtoEditado = await sock.productUpdate('id-do-produto', {
  name: 'Novo Nome',
  price: 2000,
  ...outrosCampos
})
```
Edita um produto existente no catálogo.

#### 6. Deletar Produto(s) do Catálogo

```ts
const resultado = await sock.productDelete(['id-produto-1', 'id-produto-2'])
// resultado.deleted => quantidade de produtos deletados
```
Remove um ou mais produtos do catálogo business.

### Observações

- Todos os métodos retornam Promises e devem ser usados com `await` ou `.then()`.
- Os métodos aceitam JIDs no formato padrão do WhatsApp (`@s.whatsapp.net` para contas business).
- Consulte a tipagem `ProductCreate`, `ProductUpdate` e `GetCatalogOptions` em `src/Types` para detalhes dos campos aceitos.

## Sincronização de Dados (USync)

O USync é o protocolo utilizado pelo Baileys para sincronizar contatos, grupos, mensagens e outros dados entre dispositivos de forma eficiente e segura. Ele permite que múltiplos dispositivos mantenham o mesmo estado de informações, garantindo consistência e atualização em tempo real.

### Como funciona o USync

O USync utiliza queries especializadas (USyncQuery) para buscar, atualizar e sincronizar diferentes tipos de dados. Cada protocolo USync define:
- Um nome único
- Como montar a query
- Como montar a consulta para cada usuário
- Como interpretar (parsear) o resultado

Esses protocolos são implementados via interface `USyncQueryProtocol`.

#### Exemplo de Interface USyncQueryProtocol

```ts
interface USyncQueryProtocol {
    name: string
    getQueryElement: () => BinaryNode
    getUserElement: (user: USyncUser) => BinaryNode | null
    parser: (data: BinaryNode) => unknown
}
```

### Principais Operações de Sincronização

- **Sincronizar contatos:**
  ```ts
  // Exemplo: buscar informações de um contato
  const result = await sock.onWhatsApp('jid@s.whatsapp.net')
  ```
- **Sincronizar status:**
  ```ts
  const status = await sock.fetchStatus('jid@s.whatsapp.net')
  ```
- **Sincronizar modo temporário (mensagens que somem):**
  ```ts
  const modoTemp = await sock.fetchDisappearingDuration('jid@s.whatsapp.net')
  ```
- **Sincronizar grupos, chats e outros dados:**
  - O USync pode ser utilizado internamente para manter grupos, chats e outros dados sincronizados entre dispositivos.

### Observações

- O USync é utilizado automaticamente pelo Baileys em operações de múltiplos dispositivos.
- Para uso avançado, é possível criar protocolos customizados implementando a interface `USyncQueryProtocol`.
- Consulte os arquivos `src/WAUSync/` e `src/Types/USync.ts` para detalhes de implementação e exemplos de protocolos.

## Utilitários do Socket

Os utilitários do Baileys Socket são funções auxiliares e helpers que facilitam a integração, manutenção e extensão do seu bot ou sistema. Eles abrangem desde autenticação, manipulação de eventos, armazenamento de credenciais, até processamento de mensagens, mídia e gerenciamento de sessões.

### Principais Utilitários e Helpers

#### 1. Autenticação e Persistência de Sessão
- **useMultiFileAuthState**: Permite salvar e restaurar o estado de autenticação em múltiplos arquivos, ideal para bots e aplicações persistentes.

  ```ts
  import { useMultiFileAuthState } from 'baileys'
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys')
  // Passe 'state' para o makeWASocket e salve credenciais no evento 'creds.update'
  ```
  > Dica: Sempre salve as credenciais após qualquer alteração para evitar perda de sessão.

#### 2. Manipulação e Bufferização de Eventos
- **makeEventBuffer**: Permite agrupar eventos do socket para processamento em lote, útil para sincronização e performance.
- **captureEventStream / readAndEmitEventStream**: Grave e reproduza streams de eventos para debug, testes ou replicação de cenários.

  ```ts
  import { captureEventStream, readAndEmitEventStream } from 'baileys'
  captureEventStream(sock.ev, 'eventos.log')
  // ... depois
  const ev = readAndEmitEventStream('eventos.log', 100)
  ev.on('messages.upsert', handler)
  ```

#### 3. Helpers de Mensagens e Mídia
- **downloadMediaMessage**: Faz o download de mídias recebidas de forma simples.
- **generateWAMessage / generateWAMessageFromContent**: Gera mensagens no formato aceito pelo WhatsApp, útil para customizações avançadas.
- **processMessage / decodeWAMessage**: Auxilia no processamento e decodificação de mensagens recebidas.

  ```ts
  import { downloadMediaMessage } from 'baileys'
  const buffer = await downloadMediaMessage(msg, 'buffer', {})
  ```

#### 4. Helpers de Criptografia e Signal
- **makeSignalRepository / makeLibSignalRepository**: Crie repositórios customizados para armazenar chaves Signal, integrando com bancos de dados ou sistemas distribuídos.
- **addTransactionCapability**: Adiciona suporte a transações no SignalKeyStore, importante para ambientes concorrentes.

#### 5. Utilitários de Cache e Performance
- **cachedGroupMetadata**: Implemente cache de metadados de grupos para reduzir chamadas repetidas e melhorar performance.
- **getMessage**: Permite ao Baileys buscar mensagens antigas do seu armazenamento local.

#### 6. Helpers Gerais
- **Browsers**: Permite customizar o user-agent/browser emulado pelo socket.
- **delay**: Função utilitária para aguardar um tempo (útil em fluxos assíncronos).

### Boas Práticas de Integração
- Sempre trate eventos críticos como `connection.update` e `creds.update` para garantir resiliência e persistência.
- Implemente cache e persistência para chats, grupos e mensagens, especialmente em bots de médio/grande porte.
- Use os helpers de mídia para lidar com arquivos de forma eficiente e segura.
- Para integrações avançadas, utilize e customize os repositórios Signal e as funções de cache.
- Utilize o buffer de eventos para processar grandes volumes de atualizações sem perder performance.

### Exemplos Práticos

#### Download de mídia recebida
```ts
import { downloadMediaMessage } from 'baileys'
const buffer = await downloadMediaMessage(msg, 'buffer', { })
// Salve ou processe o buffer conforme necessário
```

#### Persistência de sessão
```ts
import { useMultiFileAuthState } from 'baileys'
const { state, saveCreds } = await useMultiFileAuthState('auth')
const sock = makeWASocket({ auth: state })
sock.ev.on('creds.update', saveCreds)
```

#### Cache de metadados de grupos
```ts
const sock = makeWASocket({
  cachedGroupMetadata: async (jid) => {
    return await buscarMetadadosNoCache(jid)
  }
})
```

#### Bufferização de eventos
```ts
import { makeEventBuffer } from 'baileys'
const ev = makeEventBuffer(logger)
ev.buffer()
// ...processamento em lote
```

---

> Consulte a pasta `src/Utils/` para mais utilitários e exemplos avançados.
