# FROSTBITE 2600

Recriação de Frostbite, o cartucho que Steve Cartwright programou para a Activision em 1983, para jogar no navegador. Ajude Frostbite Bailey a erguer um iglu no Ártico antes que a temperatura chegue a zero. Feito em JavaScript puro, jogável offline, com teclado, toque ou gamepad.

O nome vem do inglês *frostbite*: o congelamento do corpo em temperaturas muito baixas. Bailey salta entre fileiras de gelo que correm em sentidos opostos, é empurrado por gansos, caranguejos e mariscos, foge do urso polar e só passa de fase quando entra no iglu pronto.

## Como jogar

Abra [index.html](index.html) diretamente no navegador ou use [dist/frostbite-2600.html](dist/frostbite-2600.html), que reúne o jogo inteiro em um único arquivo HTML. As duas versões funcionam offline, sem instalação.

Para executar o servidor local, use Node.js 20 ou superior:

```bash
npm start
```

Abra `http://127.0.0.1:3000`. As variáveis `PORT` (padrão `3000`) e `HOST` (padrão `127.0.0.1`) mudam a porta e o endereço do servidor, por exemplo `PORT=8080 HOST=0.0.0.0 npm start`.

### Controles

| Controle | Ação |
| --- | --- |
| ← / → ou A / D | Andar na margem e no gelo; no ar, corrigir o salto |
| ↓ ou S | Saltar da margem para o gelo ou para a fileira de baixo |
| ↑ ou W | Saltar para a fileira de cima ou de volta à margem; na margem, diante da porta, entrar no iglu |
| Espaço / Z / X / K | Botão vermelho: inverter a fileira de gelo em que Bailey está |
| Enter | Começar a partida; na espera, começar a jogar; durante o jogo, pausar e continuar |
| P | Pausar / continuar |
| R | GAME RESET: reiniciar a partida |
| 1 / 2 / 3 / 4 (também no teclado numérico) | Escolher o jogo e reiniciar |
| M | Ligar / desligar o som |
| C | Alternar TV colorida / preto e branco |
| L | Alternar a alavanca de dificuldade B / A (não muda as regras) |
| F | Alternar tela cheia, onde o navegador oferece; sem esse recurso, a tecla não faz nada e o botão TELA CHEIA some |

Na tela de título e no fim de jogo, o botão vermelho também começa uma partida. Comece com Enter ou com o botão vermelho, a fase mostra JOGADOR 1 e espera um novo comando do joystick ou 2,5 segundos e então corre sozinha. O aperto que começou a partida não conta como esse comando: quem começou pelo botão vermelho precisa soltá-lo e apertar de novo, ou mover o manche, para sair da espera antes do tempo. Em seguida o gelo ainda fica parado por 1,1 s, e nesse tempo o joystick não responde. O botão GAME SELECT do console percorre os jogos de 1 a 4. Depois de clicar em qualquer botão da página, o teclado volta para a tela do jogo, então Enter e Espaço continuam controlando a partida. Durante o jogo, Enter pausa; por isso o botão REINICIAR mostra a tecla R. Clicar na tela do jogo com o mouse só devolve o teclado ao jogo, sem apertar o botão vermelho. Um toque ou uma tecla soltos antes do quadro seguinte ainda contam, uma vez.

No celular, use o direcional e o botão vermelho INVERTE. Os controles aceitam dois dedos ao mesmo tempo e permitem deslizar o dedo entre as setas. Tocar na tela do jogo também aciona o botão vermelho, e por isso, no toque, a tela de título e o fim de jogo pedem TOQUE PARA JOGAR em vez de ENTER OU BOTÃO. Com o aparelho deitado, o direcional fica à esquerda da tela, o botão vermelho à direita e as chaves do console (COR · P&B, B · A, GAME SELECT e GAME RESET) numa faixa estreita logo abaixo da tela. Onde o navegador oferece tela cheia, o botão TELA CHEIA leva o direcional e o botão vermelho junto com o televisor; o Safari do iPhone não deixa páginas entrarem em tela cheia, e ali o botão não aparece. No gamepad, use o manche esquerdo ou o direcional, um dos botões de ação (A, B, X ou o gatilho direito) como botão vermelho e START para começar ou pausar. Ao sair da janela ou trocar de aba, a partida pausa e os comandos são soltos. No toque, a pausa mostra TOQUE PARA CONTINUAR: tocar na tela do jogo ou no botão vermelho retoma a partida, inclusive em tela cheia e com o aparelho deitado, e esse toque não conta como botão vermelho.

## Os quatro jogos

A chave GAME SELECT escolhe o modo, como no cartucho. A alavanca de dificuldade B/A está no console, mas este cartucho não a usa.

| Jogo | Começo |
| --- | --- |
| 1 | Regular, um jogador, fase 1 |
| 2 | Regular, dois jogadores alternados, fase 1 |
| 3 | Avançado, um jogador, fase 5 |
| 4 | Avançado, dois jogadores alternados, fase 5 |

Os jogos avançados começam na fase 5, que já é noite. No jogo de dois jogadores, cada um guarda a própria pontuação, as próprias reservas, a própria fase e o próprio iglu em construção. A vez troca quando alguém perde uma vida e o outro ainda tem vidas. O segundo jogador usa um casaco azul.

## Regras

Todos os números abaixo são os do motor (`js/config.js`, `js/world.js` e `js/game.js`). O cartucho conta o tempo em quadros de 1/60 s; os segundos entre parênteses são arredondados.

### A tela

- No alto ficam a pontuação e, na segunda linha, a temperatura com o sinal de grau e o número de reservas. O cartucho não mostra o número da fase.
- Logo abaixo do horizonte fica a margem nevada, com o iglu na ponta direita. Bailey começa cada vida na margem, em x 64.
- Abaixo da margem correm quatro fileiras de gelo e, no fundo, o mar aberto. Não há margem embaixo.
- As fileiras dão a volta na tela: o gelo que sai por um lado volta pelo outro. Bailey não dá a volta: o bloco o leva até a borda da tela (x 151 à direita; à esquerda, x 20, o mesmo limite da margem, ainda não medido no cartucho), ele fica preso ali enquanto o gelo escorrega por baixo e cai no mar quando o bloco passa. A margem não dá a volta.

### Movimento

- Bailey anda a 30 px/s na margem e no gelo e é carregado pelo bloco em que está pisando.
- Para baixo salta da margem para a primeira fileira e de uma fileira para a seguinte. Para baixo na quarta fileira não faz nada.
- Para cima salta para a fileira de cima e, da primeira fileira, de volta à margem. Na margem, para cima só serve para entrar no iglu.
- Segurar para cima ou para baixo continua saltando, como no cartucho. Cada salto dura 28 quadros (0,47 s) e segue a curva de altura do cartucho.
- No ar dá para corrigir o salto para os lados. A velocidade no ar acompanha o passo de velocidade da fase (tabela em «Gelo por fase»): 15 px/s no passo 1 e mais 3,75 px/s a cada passo.
- Bailey fica de pé enquanto o centro dos pés está sobre o gelo, com 4 px de folga além de cada borda. Pousar ou ser levado para fora do gelo derruba Bailey no mar.

### Temperatura

- A temperatura começa em 45° em toda fase e depois de toda morte.
- Ela cai 1° a cada 64 quadros (cerca de 1,07 s), na mesma velocidade em todas as fases.
- Em 0°, Bailey congela e perde uma vida.

### Gelo e iglu

- Pousar numa fileira branca acrescenta um bloco ao iglu, vale 10 × nível de pontuação (tabela abaixo) e pinta a fileira inteira de azul. O gelo azul sustenta Bailey, mas não constrói nem pontua.
- Enquanto o iglu não está pronto, quando as quatro fileiras ficam azuis todas voltam a ser brancas.
- O iglu fica pronto com 16 pousos: quinze blocos e a porta. Ele é desenhado na ordem de blocos do cartucho, e a porta aparece por último.
- Com o iglu pronto, a fileira branca ainda paga 10 × nível ao receber Bailey, mas o iglu não passa de 16 blocos e as fileiras azuis não voltam mais a ficar brancas.
- Para entrar, Bailey precisa estar na margem com x entre 120 e 127 e empurrar para cima. Passar andando pela porta não faz nada.
- Ao entrar, o mundo congela e a contagem segue o ritmo do cartucho: 8 quadros de entrada, 65 de pausa, o iglu desmontado bloco a bloco (7 quadros por bloco, 10 × nível cada), 7 quadros de intervalo, os graus restantes contados um a um (3 quadros por grau, 10 × nível cada) e 52 quadros finais. Os pontos chegam a cada passo, com som.

### Gelo por fase

- Todas as fileiras usam o mesmo desenho em cada fase. A fileira de cima corre para a esquerda e as vizinhas alternam o sentido; as fileiras 1 e 3 andam em fase, assim como as 2 e 4.
- Fases ímpares: três blocos de 16 px a cada 32 px, com 16 px de água entre eles, e mar aberto no resto da largura de 160 px.
- Fases 2 e 4: seis pedaços de 8 px, um a cada 16 px, com 8 px de água entre eles. Com a folga dos pés, dá para ficar de pé sobre qualquer grupo.
- Fases pares a partir da 6: os três blocos de 16 px se partem em duas metades de 8 px que se afastam até 8 px e voltam a se juntar, num ciclo de 256 quadros (cerca de 4,27 s) que começa aberto.
- No começo de cada fase e de cada vida, o gelo fica parado por 66 quadros (1,1 s). Nesse tempo, como no cartucho, o joystick não responde: Bailey não anda nem salta até o gelo partir.

As velocidades seguem um passo que o cartucho sobe a cada fase, mas que recua três passos a cada sete fases a partir da fase 12: as fases 1 a 11 usam os passos 1 a 11, as fases 12 a 18 usam os passos 9 a 15, as fases 19 a 25 os passos 13 a 19, e assim por diante. Por isso a fase 12 é mais lenta que a 11.

| Passo | Gelo (px/s) | Criaturas (px/s) | No ar (px/s) | Urso (px/s) |
| --- | ---: | ---: | ---: | ---: |
| 1 | 7,5 | 11,25 | 15 | — |
| 2 | 7,5 | 15 | 18,75 | — |
| 3 | 11,25 | 18,75 | 22,5 | — |
| 4 | 11,25 | 22,5 | 26,25 | 22,5 |
| 5 | 15 | 26,25 | 30 | 26,25 |
| 6 | 15 | 30 | 33,75 | 30 |
| 7 | 18,75 | 33,75 | 37,5 | 33,75 |
| 8 | 18,75 | 37,5 | 41,25 | 37,5 |
| 9 | 22,5 | 41,25 | 45 | 41,25 |
| 10 | 22,5 | 45 | 48,75 | 45 |
| 11 | 26,25 | 48,75 | 52,5 | 48,75 |

Acima disso, cada passo soma 3,75 px/s às criaturas, ao salto e ao urso, e o gelo sobe 3,75 px/s a cada dois passos, sem teto: na fase 32 (passo 23) o gelo corre a 48,75 px/s e na fase 64 (passo 40), a 78,75 px/s. O urso só existe da fase 4 em diante e, a partir da fase 7, corre mais que Bailey.

### Criaturas e peixes

- Cada fileira tem uma faixa de criaturas logo acima, que leva um grupo por vez de uma borda à outra. A sequência de grupos é sorteada por um gerador com semente: é sempre a mesma para a mesma fase e a mesma tentativa, mas muda a cada vida.
- Fase 1: só gansos. Fase 2: entram os peixes. Fase 3: entram os caranguejos-reais do Alasca. Fase 4 em diante: entram os mariscos assassinos (e o urso).
- Cada fase favorece um tipo, em ciclo: gansos na fase 1, peixes na 2, caranguejos na 3, mariscos na 4, de novo gansos na 5 e assim por diante. Até a fase 7 o tipo da vez pesa 2,5 vezes os outros no sorteio; da fase 8 em diante, só 1,5 vez, e a mistura fica quase equilibrada.
- Tamanho dos grupos: 1, 2, 2 e 1 nas fases 1 a 4; da fase 5 em diante, o ciclo 1, 2, 2, 3 se repete. Pares andam com 32 px de distância e trios com 16 px.
- Gansos, caranguejos e mariscos não matam. Quando alcançam Bailey com os pés no gelo, empurram o explorador na velocidade deles, e ele só perde a vida se for empurrado para fora do gelo e cair no mar. No ar, nada o alcança.
- Da fase 6 em diante, caranguejos e mariscos andam e param, alternando a cada 64 quadros.
- Peixes nadam nas mesmas faixas. Encoste em um com os pés na fileira dele: cada peixe vale 200 pontos. No ar, Bailey não pega peixe.

### Botão vermelho

- Inverte o sentido apenas da fileira em que Bailey está de pé. Nunca afeta o urso nem as outras fileiras.
- Custa um bloco do iglu. Com o iglu pronto, inverter é de graça.
- Sem blocos, na margem ou no meio de um salto, não faz nada.
- Cada aperto inverte uma vez só. Segurar o botão não repete a inversão, nem mesmo na passagem de uma fase para a outra.

### Urso polar

- Da fase 4 em diante, o urso polar vive na margem. Ele aparece em x 140, espera 64 quadros (cerca de 1,07 s) e passa a perseguir Bailey, a 22,5 px/s na fase 4 e mais rápido a cada passo de velocidade (tabela em «Gelo por fase»). Quando passa por Bailey, segue até 20 px além antes de dar meia-volta.
- Se encostar em Bailey na margem, arrasta o explorador para fora da tela pela esquerda e uma vida se perde. Bailey no gelo ou no ar está fora do alcance.
- O esconderijo é a ponta extrema esquerda da margem, com x até 14. Andando, Bailey para em x 20, ainda ao alcance do urso: só um salto do gelo para a esquerda o leva ao esconderijo, e o pouso na margem para em x 12, dentro dele. Ali o urso para em x 26 e não alcança Bailey. No cartucho, o esconderijo e o fim da caminhada são a borda esquerda do sprite (10 e 16); aqui x é o centro, 4 px à direita, e por isso Bailey aparece onde aparecia no original, inteiro à direita da faixa preta de 8 px na borda esquerda da tela. O pouso para em x 12, a primeira posição em que o desenho inteiro de Bailey ainda fica à direita dessa faixa. O limite do pouso e o ponto em que o urso desiste são aproximados, não foram medidos no cartucho.
- O urso é cinza de dia e branco à noite.

### Vidas e morte

- A partida começa com Frostbite Bailey em jogo e três reservas. Cada múltiplo de 5.000 pontos alcançado dá mais uma reserva, até nove.
- Há três formas de perder uma vida: cair no mar, congelar a 0° ou ser pego pelo urso. Cada uma tem sua animação de 200 quadros (cerca de 3,3 s): Bailey afunda, congela em quatro tons de azul a partir dos pés ou é arrastado pelo urso. A barra de estado diz o motivo e, quando foi um empurrão, nomeia a criatura.
- A morte não desmancha o iglu. A temperatura volta a 45°, Bailey volta à margem e o gelo, as fileiras brancas, as criaturas e o urso recomeçam.
- O placar tem seis dígitos e volta a zero ao passar de 999.999. Essa virada também conta como um múltiplo de 5.000 e dá reserva.

### Pontuação

O nível de pontuação é o número da fase, limitado a 9.

| Nível | Bloco de gelo branco | Entrar no iglu (16 blocos) | Cada grau restante |
| --- | ---: | ---: | ---: |
| 1 | 10 | 160 | 10 |
| 2 | 20 | 320 | 20 |
| 3 | 30 | 480 | 30 |
| 4 | 40 | 640 | 40 |
| 5 | 50 | 800 | 50 |
| 6 | 60 | 960 | 60 |
| 7 | 70 | 1.120 | 70 |
| 8 | 80 | 1.280 | 80 |
| 9 | 90 | 1.440 | 90 |

O bônus de temperatura é `10 × graus restantes × mín(fase, 9)`, no máximo 45 × 90 = 4.050 pontos. Peixes valem sempre 200.

### Dia, noite e marcas

- O dia e a noite se revezam a cada quatro fases: fases 1 a 4 de dia, 5 a 8 à noite, 9 a 12 de dia, e assim por diante.
- Da fase 21 em diante, o peixe mágico aparece na segunda linha do placar, entre a temperatura e o número de reservas.
- Ao chegar a 40.000 pontos, a barra de configuração do console, no fim do manual da página, mostra a nota Arctic Architect.
- O recorde fica no `localStorage`, quando o navegador permite.

## Estrutura

- `index.html` e `css/style.css`: página, TV, chaves do console, manual, estados acessíveis e controles de toque.
- `js/config.js`: coordenadas da tela, paletas do dia e da noite, tempos, velocidades por fase, temperatura e pontuação.
- `js/sprites.js`: Bailey, urso, ganso, caranguejo, marisco, peixe, peixe mágico, blocos e porta do iglu, dígitos do placar e assinatura ACTIVISION.
- `js/world.js`: fileiras de gelo e seus formatos, apoio dos pés, grupos de criaturas com sorteio por semente e o urso.
- `js/game.js`: simulação independente do DOM (saltos, iglu, contagem, vidas, dois jogadores, placar), desenho no canvas e o loop do navegador.
- `js/input.js`: teclado, botões, vários toques e Gamepad API. Guarda os apertos mais curtos que um quadro e solta os comandos ao perder o foco.
- `js/audio.js`: síntese com ondas quadradas e um canal de ruído LFSR, ao estilo do chip de som do console, iniciada depois de um gesto do jogador.
- `tools/build-artifact.js`: gera o HTML portátil em `dist/`.
- `tools/serve.js`: servidor estático local, sem dependências.
- `tools/test.js`, `tools/test-play.js` e `tools/browser-test.js`: testes do motor, uma partida jogada só com os controles e o jogo no Chromium.

## Desenvolvimento

Os testes do motor usam só o Node.js:

```bash
npm test
npm run test:play
```

`npm test` confere as regras do motor. `npm run test:play` joga as fases 1 a 6 só com os controles, começando pelo botão vermelho, saindo da espera com o joystick para baixo e entrando em cada iglu, e repete a partida para conferir que o resultado é o mesmo. As fases 1 a 6 passam por todos os formatos de gelo, pela noite e pelo urso; `node tools/test-play.js N` joga as fases 1 a N, com N de 1 a 9. A partir da fase 10 o urso anda mais rápido que Bailey e a primeira fileira o afasta da porta, e o robô não sabe dar a volta pelo gelo nem esperar o urso se afastar, então N maior que 9 é recusado.

Para os testes no Chromium, instale as dependências de desenvolvimento e o navegador:

```bash
npm ci
npx playwright install chromium
npm run test:browser
```

Eles conferem teclado, gamepad, toque, apertos mais curtos que um quadro, pausa, recorde, chaves do console, layout com o celular em pé e deitado, tela cheia (com a API padrão, só com a prefixada e sem nenhuma) e o HTML offline. As capturas ficam em `test-results/`.

Depois de alterar o jogo, atualize o HTML portátil:

```bash
npm run build
```

## Sobre a recriação

Frostbite foi lançado em 1983 pela Activision para o Atari 2600, com programação de Steve Cartwright. O jogador controla Frostbite Bailey, que precisa erguer um iglu no Ártico saltando sobre blocos de gelo enquanto a temperatura despenca e a fauna do mar atravessa o caminho.

No Brasil, o Atarimania registra uma edição da Polyvox de 1983 (grafada Polivox em fontes brasileiras). A Wikipédia em português atribui o cartucho também à CCE, mas nenhum catálogo consultado confirma essa edição.

O manual convidava os jogadores a entrar para os Arctic Architects, os Arquitetos do Ártico: quem mandasse à Activision uma foto da TV com pelo menos 40.000 pontos recebia o emblema oficial. O manual diz ainda que um peixe mágico aparece perto do placar depois de muitos pontos; no cartucho, ele surge a partir da fase 21.

As regras, os tempos, as velocidades, as posições e as cores desta versão foram medidos no cartucho original rodando em emulador (Stella, por meio do Arcade Learning Environment), quadro a quadro e com leitura da memória do console, e conferidos com o manual. Onde fontes secundárias divergem do cartucho, vale o que o cartucho faz.

Fontes:

- [Manual do Frostbite no AtariAge](https://atariage.com/manual_html_page.php?SoftwareLabelID=199)
- [Manual original da Activision em PDF (regvault)](https://api.regvault.org/api/v1/game/atari2600/4ca73eb959299471788f0b685c3ba0b5/manual)
- [Frostbite no Atarimania, com as edições conhecidas](https://www.atarimania.com/game-atari-2600-vcs-frostbite_8197.html)
- [Frostbite na Wikipédia em inglês](https://en.wikipedia.org/wiki/Frostbite_(video_game))
- [Frostbite na Wikipédia em português](https://pt.wikipedia.org/wiki/Frostbite_(jogo_eletrônico))
- [Artigo do Orphaned Games sobre Frostbite](https://orphanedgames.com/articles/Bookcast_Articles/frostbite.html)

Esta é uma recriação independente, sem afiliação com a Activision ou com os fabricantes brasileiros.
