# Corrida de Seguidores (Instagram)

Site simples para mostrar quantos seguidores faltam para o seu perfil ultrapassar o seu principal concorrente.

## O que o projeto faz

- Consulta automaticamente os seguidores de:
  - `canaloamador`
  - `mundotrilive`
- Atualiza essa consulta no servidor a cada 15 minutos
- Mostra no site apenas o contador central com a quantidade que falta para ultrapassar
- Mantem o ultimo valor valido se o Instagram oscilar temporariamente

## Requisitos

- Node.js 18+ (ou superior)
- npm

## Como rodar

1. Instale dependencias:

```bash
npm install
```

2. Inicie o servidor:

```bash
npm start
```

3. Abra no navegador:

[http://localhost:3000](http://localhost:3000)

## Estrutura

- `server.js`: API local e atualizacao automatica a cada 15 minutos
- `public/index.html`: pagina principal
- `public/styles.css`: estilo da interface
- `public/script.js`: logica da pagina e calculo

## Observacoes

- O Instagram pode limitar ou bloquear consultas em alguns momentos.
- Se isso acontecer, aguarde alguns minutos e tente novamente.
- Funciona melhor para perfis publicos.
