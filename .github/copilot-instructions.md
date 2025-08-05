# Mensagem de Commit
**PRIORIDADE MÁXIMA: Todas as mensagens de commit DEVEM ser escritas em inglês.**

A mensagem de commit deve ser clara e concisa, descrevendo a alteração feita. Deve obrigatoriamente seguir o formato: `type: description` sempre em inglês. Exemplos:
- `feat: add login feature`
- `fix: correct user endpoint`
- `docs: update installation instructions`
- `refactor: improve button reusability`
- `style: adjust header spacing`

# Nunca comente no código
Comentários só devem ser adicionados quando explicitamente solicitados. Não insira comentários automaticamente.

# Nunca crie, renomeie ou exclua arquivos sem necessidade explícita
Alterações estruturais no projeto devem ocorrer apenas mediante instrução direta. Não modifique a estrutura sem autorização.

# Corrija de forma cirúrgica
Altere somente o que for estritamente necessário. Não reescreva trechos inteiros se apenas uma pequena parte exige correção.

# Preserve o estilo e estrutura original do código
Respeite o padrão de indentação, nomenclatura e organização existentes no projeto. Não aplique reformatações automáticas.

# Evite sugestões genéricas
Forneça soluções específicas e contextualizadas. Não generalize nem ofereça alternativas não solicitadas.

# Analisar o código dentro das pastas src do frontend e backend para analisar o que pode ser melhorado
Sempre que sugerir melhorias, analise o código dentro das pastas `src` do frontend e backend. Foque em otimizações que respeitem a lógica existente e melhorem a performance ou legibilidade.

# Evite duplicação de código e busque sempre a reutilização de componentes.
Sempre que possível, proponha a reutilização de componentes existentes em vez de criar novos. Isso ajuda a manter o código limpo e reduz a complexidade do projeto.

# Sempre que sugerir alterações, verifique se o código está atualizado com as últimas dependências e práticas recomendadas
Antes de propor qualquer modificação, verifique se o código está alinhado com as últimas versões das dependências e as melhores práticas recomendadas. Isso garante que as alterações sejam compatíveis e aproveitem os recursos mais recentes disponíveis.

# Sempre que possível, utilize o comando 'yarn build' para garantir que as alterações estejam corretas e otimizadas.
Sempre que sugerir alterações, execute o comando `yarn build` para garantir que as modificações estejam corretas e otimizadas. Isso ajuda a identificar problemas de compilação e garante que o código esteja pronto para produção.

# Sempre executar 'yarn lint:fix' ao modificar arquivos.
Sempre que fizer alterações em arquivos, execute o comando `yarn lint:fix` para corrigir automaticamente problemas de formatação e estilo. Isso ajuda a manter a consistência do código e a evitar erros comuns.

# Type de Commit
Ao criar um commit, sempre inclua um _type_ e um _scope_ (opcional) na mensagem do commit. O _type_ deve ser um dos seguintes tipos, e o _scope_ deve ser uma breve descrição do que foi alterado ou adicionado. A mensagem deve seguir o formato: `type(scope): descrição`.
O _type_ pode ser um desses tipos:

| Prefixo | Descrição           | Significado                                    |
|---------|---------------------|------------------------------------------------|
| feat    | Features            | Uma nova funcionalidade                        |
| fix     | Correções de Erros  | Uma correção de bug                            |
| docs    | Documentação        | Apenas mudanças na documentação               |
| style   | Estilos             | Mudanças em relação a estilização              |
| refactor| Refatoração de Código | Uma alteração de código que não corrige um bug nem adiciona uma funcionalidade |
| perf    | Melhorias de Performance | Uma alteração de código que melhora o desempenho |
| test    | Testes              | Adição de testes em falta ou correção de testes existentes |
| build   | Builds              | Mudanças que afetam o sistema de build ou dependências externas (exemplos de escopos: gulp, broccoli, npm) |
| ci      | Integrações Contínuas | Alterações em nossos arquivos e scripts de configuração de CI (exemplos de escopos: Travis, Circle, BrowserStack, SauceLabs) |
| chore   | Tarefas             | Outras mudanças que não modificam arquivos de código-fonte ou de teste |
| revert  | Reverter            | Reverte um commit anterior                    |
