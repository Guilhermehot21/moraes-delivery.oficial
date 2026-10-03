# Moraes Delivery — versão final corrigida

## O que foi corrigido/adicionado
- Controle de loja **aberta/fechada** pelo painel, com destaque no site.
- Loja fechada bloqueia novos pedidos também no servidor.
- **Tempo estimado de entrega** editável pelo painel e mostrado ao cliente.
- **Valor mínimo do pedido** editável pelo painel e validado no servidor.
- **PIX, dinheiro, cartão de débito e cartão de crédito** configuráveis pelo painel.
- Forma de pagamento fica gravada no pedido e aparece no painel/WhatsApp.
- **Excluir pedido** no painel, com confirmação.
- WhatsApp normalizado para gerar `wa.me` corretamente usando DDD + número.
- Pedido confirmado mostra tempo estimado e pagamento.
- Rotas `/admin` e `/admin/` continuam apontando para o painel administrativo.
- Migração automática do banco para a nova coluna `payment_method` e novas configurações.

## Primeiro uso
1. Crie um arquivo `.env` na raiz, usando `.env.example` como modelo.
2. Coloque sua `DATABASE_URL`, `JWT_SECRET` e `ADMIN_PASSWORD` reais.
3. No CMD, dentro da pasta do projeto:

```cmd
npm install
node --env-file=.env server.js
```

4. Abra:
- Loja: `http://localhost:3000/`
- Painel: `http://localhost:3000/admin`

## Importante
- **Não envie o `.env` para o GitHub.**
- Não é necessário enviar `node_modules`; o cliente pode rodar `npm install`.
- Se a porta 3000 estiver ocupada, encerre o outro processo Node antes de iniciar esta versão.
