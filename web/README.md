# lyricburn — editor web

Interface do `lyricburn`, em Angular (standalone + signals), falando com a API em `lyricburn/server`.

## Rodar

Precisa dos **dois** processos. Em dois terminais:

```bash
# 1) API (na raiz do repo)
py -3.13 -m lyricburn.server          # http://127.0.0.1:8000

# 2) interface (nesta pasta)
npm start                             # http://localhost:4200
```

O `proxy.conf.json` manda `/projects`, `/jobs`, `/fonts` e `/config` pro uvicorn,
então o front chama caminhos relativos e não existe CORS no caminho do dia a dia.

Se a API estiver em outra porta, mude só o `proxy.conf.json`.

## Como está organizado

```
core/
  types.ts          LyricConfig — espelho do config.py (mesmos nomes, mesmos defaults)
  api.ts            cliente HTTP tipado
  config.store.ts   a config num signal + presets
  project.store.ts  projeto, fontes e o plan (refeito sozinho quando a config muda)
  render.store.ts   dispara o render e acompanha o job
ui/
  header · preview · panel (5 abas) · timeline · export-bar · controls
```

O estado é todo signal, sem RxJS fora do `HttpClient`. Quem edita um campo chama
`config.patch('style', 'size', 52)`; o resto reage.

### O plan se refaz sozinho — e a legenda aparece na hora

`ProjectStore` observa a config e, 350 ms depois da última mexida, pede um `/plan`
novo. Volta o resumo (duração, pausas, notas) **e o `.ass`**, que o `LiveSubtitles`
entrega pro [JASSUB](https://github.com/ThaUnknown/jassub) desenhar por cima do vídeo.

O JASSUB é o libass compilado pra WebAssembly — o mesmo motor que o ffmpeg usa pra
queimar a legenda no export. Então a prévia não é uma imitação em CSS: é o mesmo
`.ass`, as mesmas fontes (vindas de `GET /fonts/{nome}`), o mesmo resultado. Com o
vídeo pausado, o quadro é redesenhado a cada mudança: dá pra acertar fonte, cor,
tamanho e posição sem dar play nem exportar.

Mexer só no estilo acerta o cache do servidor e responde em ~0,1 s.

O worker do JASSUB importa pacotes por nome e o builder do Angular não o empacota
de dentro do `node_modules`, então `scripts/prepare-jassub.mjs` gera
`public/jassub/` (worker + `.wasm` + fonte padrão) com o esbuild. Roda sozinho no
`npm start` e no `npm run build`; depois de atualizar o `jassub`, rode
`npm run jassub`.

### O id do projeto fica na URL, a config no localStorage

`?project=<id>` traz o projeto de volta; a config fica salva por id de projeto,
junto com o último export concluído — então o F5 devolve projeto, ajustes e o
"Com legenda". Config salva por uma versão antiga do app é mesclada por cima dos
defaults, pra não faltar campo novo.

O export volta só enquanto a API estiver de pé: os jobs vivem na memória dela.

### Original × Com legenda

O botão acima do vídeo troca entre o original (com a legenda ao vivo, que dá pra
desligar) e o resultado do último export, servido por `GET /jobs/{id}/video`. A
troca mantém o ponto e o play — os dois clipes têm a mesma linha do tempo — e
limita à duração do clipe novo quando o render é mais curto.

Ela acontece sozinha uma vez, quando o export termina; depois a escolha é de quem
está usando. Não gostou? Volte pro Original, ajuste vendo a legenda ao vivo e use
**Regerar com as mudanças** — o botão aparece no lugar do download assim que a
config diverge do vídeo exportado.

## De onde vem o vídeo da prévia

O `<video>` tenta o arquivo original. Quando o navegador não dá conta — `.mkv`,
HEVC, ou um Chromium sem os codecs proprietários — a UI pede
`GET /projects/{id}/preview`, que transcodifica uma cópia de 854 px e guarda em
disco. A troca acontece por dois caminhos, porque nenhum basta sozinho:

* **antes de tentar**, por extensão/codec + `canPlayType`;
* **depois de tentar**, no evento `error` do elemento.

Tem navegador que responde `probably` pra H.264 e mesmo assim entrega quadro
preto. Pra esses, `?preview=webm` na URL força a cópia VP9/Opus — serve também
pra depurar codec numa máquina específica. Se nem a cópia tocar, a prévia mostra
o erro em vez de ficar preta.

Detalhe que custou caro: com `preload="metadata"`, o elemento **não decodifica
quadro nenhum** até alguém pedir um tempo diferente do atual. Por isso o
`loadedmetadata` faz um seek mínimo — sem ele a prévia fica preta até dar play,
com qualquer formato.

## Timeline

A faixa de baixo é [wavesurfer.js](https://wavesurfer.xyz) v7 com o plugin Regions,
tudo em **tempo da música**. A região verde é a janela que vira vídeo: tem o
tamanho da duração do vídeo, arrasta mas não redimensiona, e é o próprio
`timing.music_start` — arrastar escreve no campo "Música começa em", e digitar no
campo move a janela. Arrastar limpa o "começar na linha", que senão anularia a
escolha.

| Ação | O que faz |
|---|---|
| passar o mouse | mostra o tempo e a linha da letra naquele ponto |
| clicar na waveform / num bloco da letra | toca só a música dali, num `<audio>` próprio |
| duplo clique num bloco | põe a janela na linha menos o `lead_in` |
| espaço | toca / pausa (com a timeline em foco) |
| Enter ou **começar aqui** | o vídeo começa no ponto que você está ouvindo |
| ← / → | move a janela 0,1 s; com Shift, 1 s |
| **ouvir trecho** | toca da entrada até o fim da janela |
| **snap** | ao soltar, gruda no início de linha (prioridade) ou no beat mais próximo |

Os beats vêm de `GET /projects/{id}/beats` (`librosa.beat.beat_track`, com cache
por projeto: ~15 s na primeira vez, instantâneo depois) e aparecem como risquinhos
com zoom suficiente. Pro zoom não virar blocos, a timeline pede a waveform em
~40 barras/s via `GET /projects/{id}/peaks`.

Detalhe que custou caro: a timeline precisa de `min-width: 0`. Sem ele, ela é um
item de grid que cresce até a largura do conteúdo — e com zoom o conteúdo é a
waveform inteira, que se redimensiona pra caber, e o zoom realimenta a si mesmo.

## Fontes

A tipografia da interface (Space Grotesk e IBM Plex Mono) vem do `@fontsource`,
no bundle — sem CDN, funciona offline.

As fontes do **seletor de estilo** são outra coisa: vêm do `GET /fonts` da API e são
registradas no navegador via `FontFace`, baixando de `GET /fonts/{nome}`. Por isso a
lista mostra só o que o libass consegue achar na hora de queimar — um nome que a API
não conhece sairia errado no vídeo final.
