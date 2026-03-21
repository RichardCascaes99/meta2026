# Corrida de Seguidores (Instagram)

Site simples para mostrar quantos seguidores faltam para o seu perfil ultrapassar o seu principal concorrente.

## O que o projeto faz

- Recebe dois usuarios de Instagram:
  - o seu perfil
  - o perfil concorrente
- Consulta a quantidade de seguidores de cada um
- Mostra automaticamente:
  - seguidores atuais dos dois perfis
  - quantos seguidores faltam para voce ultrapassar

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

- `server.js`: API local para consultar seguidores no Instagram
- `public/index.html`: pagina principal
- `public/styles.css`: estilo da interface
- `public/script.js`: logica da pagina e calculo

## Observacoes

- O Instagram pode limitar ou bloquear consultas em alguns momentos.
- Se isso acontecer, aguarde alguns minutos e tente novamente.
- Funciona melhor para perfis publicos.
