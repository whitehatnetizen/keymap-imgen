# Bundled fonts

Every family here is published under the SIL Open Font License 1.1 (`OFL.txt` in this
folder), which permits bundling and redistribution with software. The woff2 files are the
latin subsets as served by Google Fonts; `-variable` files carry the whole weight range.

| Family | Files | Copyright | Used by |
|---|---|---|---|
| Orbitron | `Orbitron-variable.woff2` (weights 400 to 900) | Copyright 2018 The Orbitron Project Authors (github.com/theleagueof/orbitron) | outrun, outrun_light |
| Share Tech Mono | `ShareTechMono-400-normal.woff2` | Copyright 2012 Carrois Type Design (carrois.com) | outrun, outrun_light, terminal, terminal_light, nuclear, nuclear_light |
| Barlow | `Barlow-400/500/600/700-normal.woff2` | Copyright 2017 The Barlow Project Authors (github.com/jpt/barlow) | blueprint, blueprint_light, nuclear, nuclear_light (weights 500 and 700; 400 and 600 are shipped for styles that want them) |
| Martian Mono | `MartianMono-400-normal.woff2` | Copyright 2022 The Martian Mono Project Authors (github.com/evilmartians/mono) | blueprint, blueprint_light |
| Hanken Grotesk | `HankenGrotesk-variable-normal.woff2` | Copyright 2019 The Hanken Grotesk Project Authors (github.com/marcologous/hanken-grotesk) | obsidian, obsidian_light, retro, retro_light, nord, nord_light |
| JetBrains Mono | `JetBrainsMono-variable-normal.woff2` | Copyright 2020 The JetBrains Mono Project Authors (github.com/JetBrains/JetBrainsMono) | obsidian, obsidian_light, cyberpunk, cyberpunk_light, catppuccin, catppuccin_light, nord, nord_light, tokyonight, tokyonight_light, and index.html itself |
| Libre Franklin | `LibreFranklin-variable-normal.woff2` | Copyright 2015 The Libre Franklin Project Authors (github.com/impallari/Libre-Franklin) | slate, slate_light, paper, paper_dark |
| Fragment Mono | `FragmentMono-400-normal.woff2` | Copyright 2022 The Fragment Mono Project Authors (github.com/weiweihuanghuang/fragment-mono) | slate, slate_light, paper, paper_dark, torii, torii_light, sakura, sakura_dark, dracula, dracula_light |
| Fredoka | `Fredoka-variable-normal.woff2` (weights 300 to 700) | Copyright 2021 The Fredoka Project Authors (github.com/hafontia-zz/Fredoka) | bubblegum, bubblegum_light |
| Nunito | `Nunito-variable-normal.woff2` (weights 400 to 900) | Copyright 2014 The Nunito Project Authors (github.com/googlefonts/nunito) | bubblegum, bubblegum_light, catppuccin, catppuccin_light |
| VT323 | `VT323-400-normal.woff2` | Copyright 2011 The VT323 Project Authors (github.com/phoikoi/VT323) | terminal, terminal_light |
| Chakra Petch | `ChakraPetch-400/600/700-normal.woff2` | Copyright 2018 Cadson Demak (cadsondemak.com) | cyberpunk, cyberpunk_light |
| IBM Plex Sans | `IBMPlexSans-variable-normal.woff2` | Copyright 2017 IBM Corp. (github.com/IBM/plex) | corporate, corporate_dark, gruvbox, gruvbox_light, tokyonight, tokyonight_light |
| IBM Plex Mono | `IBMPlexMono-400/500-normal.woff2` | Copyright 2017 IBM Corp. (github.com/IBM/plex) | corporate, corporate_dark, retro, retro_light |
| Newsreader | `Newsreader-variable-normal.woff2`, `Newsreader-variable-italic.woff2` | Copyright 2020 The Newsreader Project Authors (github.com/productiontype/Newsreader) | paper, paper_dark, dracula, dracula_light |
| Source Code Pro | `SourceCodePro-variable-normal.woff2` | Copyright 2010, 2012 Adobe Systems Incorporated (github.com/adobe-fonts/source-code-pro) | solarized, solarized_light, gruvbox, gruvbox_light |
| Source Sans 3 | `SourceSans3-variable-normal.woff2` | Copyright 2010, 2012 Adobe Systems Incorporated (github.com/adobe-fonts/source-sans) | solarized, solarized_light |
| Shippori Mincho | `ShipporiMincho-400/700-normal.woff2` | Copyright 2021 The Shippori Mincho Project Authors (github.com/fontdasu/ShipporiMincho) | torii, torii_light, sakura, sakura_dark |
| Zen Kaku Gothic New | `ZenKakuGothicNew-400/500/700-normal.woff2` | Copyright 2022 The Zen Project Authors (github.com/googlefonts/zen-kakugothic) | torii, torii_light, sakura, sakura_dark |
| Pirata One | `PirataOne-400-normal.woff2` | Copyright (c) 2012, Rodrigo Fuenzalida, Nicolas Massi (www.taip.com.ar), with Reserved Font Name 'Pirata' | dracula, dracula_light |

The `plain` styles (`plain`, `plain_cream`, `plain_ink`) `sage` / `sage_dark` and `high_contrast` / `high_contrast_dark` use no bundled fonts. A style references a font as
`url('fonts/<file>')`; the renderer embeds the bytes into the HTML at build time.
