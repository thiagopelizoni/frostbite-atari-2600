# FROSTBITE 2600

Frostbite para o navegador: ajude Frostbite Bailey a construir um iglu no Ártico antes que a temperatura chegue a zero. Feito em JavaScript, jogável offline, com teclado, toque ou gamepad.

O nome vem do inglês *frostbite*: o congelamento do corpo em temperaturas muito baixas. Bailey salta entre blocos de gelo que correm em sentidos opostos, foge de criaturas marinhas e do urso polar, e só passa de fase quando a porta do iglu abre e ele entra.

## Como jogar

Abra [index.html](index.html) diretamente no navegador ou use [dist/frostbite-2600.html](dist/frostbite-2600.html), que reúne o jogo em um único arquivo HTML. As duas versões funcionam offline, sem instalação.

Para executar o servidor local, use Node.js 20 ou superior:

```bash
npm start
```

Abra `http://localhost:3000`. As variáveis `PORT` e `HOST` permitem configurar a porta e o endereço do servidor.

| Controle | Ação |
| --- | --- |
| ← / → ou A / D | Andar para a esquerda / direita |
| ↑ / ↓ ou W / S | Saltar para a fileira de cima / de baixo |
| Espaço / Z / X | Inverter a direção do gelo em que Bailey está |
| Enter | Iniciar, começar a fase ou pausar durante o jogo |
| P | Pausar / continuar |
| R | Reiniciar a partida |
| M | Ligar / desligar o som |
| C | Alternar TV colorida / preto e branco |
| L | Alternar a alavanca B / A (não muda as regras) |
| 1 / 2 / 3 / 4 | Selecionar o jogo |
| F | Alternar tela cheia, quando o navegador permitir |

No celular, use o direcional e o botão vermelho INVERTE. Os controles aceitam dois dedos ao mesmo tempo e permitem deslizar entre as setas. Tocar na tela também inverte o gelo. No gamepad, use o manche esquerdo ou o direcional, um botão de ação para inverter e START para iniciar ou pausar. Ao sair da janela ou trocar de aba, a partida pausa.

## Os quatro jogos

A chave GAME SELECT escolhe o modo, como no cartucho. A alavanca de dificuldade B/A está no console, mas este cartucho não a usa.

| Jogo | Começo |
| --- | --- |
| 1 | Regular, um jogador, fase 1 |
| 2 | Regular, dois jogadores alternados, fase 1 |
| 3 | Avançado, um jogador, fase 5 |
| 4 | Avançado, dois jogadores alternados, fase 5 |

No jogo de dois jogadores, cada um guarda a própria pontuação, as próprias reservas e a própria fase. A vez troca quando alguém perde uma vida. O segundo jogador usa um casaco azul.

## Regras

- Você começa com Frostbite Bailey em jogo e três reservas. A cada 5.000 pontos ganha uma reserva, até nove.
- Há quatro fileiras de gelo. Cada fileira corre para um lado, no sentido contrário da vizinha. Bailey é carregado pelo bloco em que está pisando.
- Saltar sobre um bloco branco acrescenta um bloco ao iglu e vale os pontos da fase. A fileira inteira fica azul. Azul ainda sustenta os pés, mas não constrói nem pontua. Quando as quatro fileiras estão azuis, todas voltam a ficar brancas.
- O iglu fica pronto com 16 blocos. A porta aparece na margem de cima, à direita. Entrar nela termina a fase.
- Cair na água custa uma vida. Gansos, caranguejos e mariscos também: eles só pegam Bailey com os dois pés no gelo. No ar, dá para passar por cima.
- O botão vermelho inverte o bloco de gelo em que Bailey está e, se o urso já saiu, inverte o urso também. Cada uso desfaz um bloco do iglu, a menos que a porta já esteja aberta.
- O urso polar aparece na fase 4 e patrulha a margem de cima. O extremo esquerdo dessa margem é o esconderijo: ali ele não alcança.
- Peixes cruzam a água entre as fileiras. Pegá-los no salto vale 200 pontos.
- A temperatura é o relógio da fase. Em zero, Bailey morre de frio. Ao entrar no iglu, cada grau que ainda restava vira bônus.
- O dia e a noite se revezam a cada quatro iglus. O gelo fica mais rápido e o frio, mais apressado.
- O recorde fica no `localStorage`, quando o navegador permite. Aos 100.000 pontos um peixe mágico aparece ao lado do placar. Quem completa vinte iglus ganha a marca de arquiteto na barra.

| Fase | Pontos por bloco | Entrar no iglu |
| --- | ---: | ---: |
| 1 | 10 | 160 |
| 2 | 20 | 320 |
| 3 | 30 | 480 |
| 4 | 40 | 640 |
| 5 | 50 | 800 |
| 6 | 60 | 960 |
| 7 | 70 | 1120 |
| 8 | 80 | 1280 |
| 9 | 90 | 1440 |

A partir da nona fase, o bloco e a entrada permanecem em 90 e 1440. O bônus da temperatura é sempre `10 × graus restantes × número da fase`.

## Estrutura

- `index.html` e `css/style.css`: página, TV, chaves, instruções, estados acessíveis e controles de toque.
- `js/config.js`: dimensões, paleta do dia e da noite, velocidades, temperatura e pontuação.
- `js/sprites.js`: Bailey, urso, peixe, ganso, caranguejo, marisco e as letras do placar.
- `js/world.js`: fileiras de gelo, vãos de água, criaturas e o urso de cada fase.
- `js/game.js`: simulação independente do DOM, saltos, iglu, vidas, dois jogadores, placar, desenho e o loop do navegador.
- `js/input.js`: teclado, botões, vários toques e Gamepad API. Solta os comandos ao perder o foco.
- `js/audio.js`: síntese com ondas quadradas, iniciada depois de um gesto do jogador.
- `tools/build-artifact.js`: versão HTML portátil.
- `tools/serve.js`: servidor estático local, sem dependências.
- `tools/test.js`, `tools/test-play.js` e `tools/browser-test.js`: motor, uma partida jogada e o jogo no Chromium.

## Desenvolvimento

Os testes do motor usam só o Node.js:

```bash
npm test
npm run test:play
```

`test:play` joga a primeira fase só com os controles, até entrar no iglu.

Para os testes no Chromium, instale as dependências de desenvolvimento e o navegador:

```bash
npm ci
npx playwright install chromium
npm run test:browser
```

Eles conferem teclado, gamepad, toque, pausa, recorde, chaves do console, layout e o HTML offline. As capturas ficam em `test-results/`.

Depois de alterar o jogo, atualize o HTML portátil:

```bash
npm run build
```

## Sobre o cartucho

Frostbite foi lançado em 1983 pela Activision. O programador é Steve Cartwright. O jogador controla Frostbite Bailey, que precisa erguer um iglu no Ártico saltando em blocos de gelo, enquanto a temperatura despenca e a fauna do lago atravessa o caminho.

No Brasil, o cartucho também foi fabricado pela Polivox e pela CCE.

A Activision reconhecia quem fotografasse a televisão com pelo menos 40.000 pontos: essas fotos valiam o emblema Arctic Architect, o Arquiteto do Ártico. O peixe mágico ao lado do placar era o outro sinal de que a partida tinha ido longe.

Esta versão usa sprites em bitmap, áudio sintetizado e uma tela com aspecto 4:3. A fase 1 ensina o lago. Da fase 2 em diante entram mariscos e caranguejos; da fase 4 em diante, o urso. Cada iglu concluído deixa o gelo mais rápido e o termômetro mais curto.
