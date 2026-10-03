# Moraes Delivery

Sistema de delivery para açaí/conveniência, com:

- Cardápio por categorias
- Açaí com tamanhos, caldas e adicionais
- Carrinho
- Delivery ou retirada
- Taxas configuráveis
- Criação de pedidos
- Histórico local de pedidos do cliente
- Painel administrativo
- Produtos, categorias, adicionais e taxas editáveis
- Disponibilidade/indisponibilidade de produtos
- Dashboard com faturamento mensal
- Status dos pedidos

## Requisitos

- Node.js 20+
- PostgreSQL (Neon é uma opção)
- npm

## Rodar localmente

1. Copie `.env.example` para `.env`.
2. Preencha `DATABASE_URL`, `JWT_SECRET` e `ADMIN_PASSWORD`.
3. Instale:
   `npm install`
4. Inicie:
   `npm start`
5. Abra:
   `http://localhost:3000`

Na primeira inicialização o servidor cria as tabelas e popula o catálogo inicial.

## Painel

`http://localhost:3000/admin.html`

Use a senha definida em `ADMIN_PASSWORD`.

## Produção

Configure as mesmas variáveis de ambiente na hospedagem e use um PostgreSQL persistente. Não coloque `.env` no GitHub.

## Observação

Os preços iniciais são baseados nas imagens fornecidas quando havia preço. Itens sem preço confirmado entram como indisponíveis para você ajustar no painel antes de publicar.


### Fotos dos produtos
O painel administrativo agora permite selecionar uma foto diretamente do celular ou computador. A imagem é comprimida no navegador e armazenada no PostgreSQL, então não depende do disco temporário da hospedagem. Também é possível remover a foto ou continuar usando uma URL.
