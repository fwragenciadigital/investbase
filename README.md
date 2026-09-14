# InvestBase — dados públicos do Tesouro Direto

Este repositório publica dados oficiais normalizados para o InvestPortfolio.

- Fonte: CSV oficial do Tesouro Transparente.
- Saída: `data/tesouro-atual.json` e `data/tesouro-status.json`.
- Frequência: dias úteis, com execução manual disponível em **Actions**.
- Segurança: não contém dados de usuários, contas, investimentos, tokens ou segredos.

O fluxo mantém o último `tesouro-atual.json` válido se a fonte oficial estiver indisponível.
