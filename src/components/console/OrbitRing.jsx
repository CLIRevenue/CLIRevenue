/* =============================================================
   CLIRevenue — the agent drum
   -------------------------------------------------------------
   A genuine WebGL cylinder on a sticky cinematic scroll stage:
   a rotating visual index of the modern AI coding CLI ecosystem —
   Claude Code, Codex, Cline, OpenCode, Gemini CLI, Aider,
   Copilot CLI and a local/self-hosted runtime — eight premium
   terminal cards painted into one local atlas. Each card is painted as its own program: the tool's real
   identity treatment, transcript frame, input style and status
   chrome — never one card repeated — and every tool's genuinely
   free strip (status line, quota row, cost line) carries a
   permanent placement; the bare shell, which has no idle chrome,
   reserves a band that fills only once stdout finishes printing. The CLIRevenue
   black/white/red system end to end: pure #000000 surfaces,
   #ffffff ink, white hairline frames, IBM Plex Mono terminal
   readouts and one red accent (#ff1f2d). Nothing else is a colour —
   the cylinder reads as white-and-red instrumentation emerging from
   a black void.

   `.orbit` owns the scroll distance (the cinematic duration),
   `.orbit__sticky` pins a 100vh frame while the section is in play,
   and the drum releases naturally when the stage ends.

   One ScrollTrigger — the same Lenis → ScrollTrigger system the film
   already runs — derives normalized progress. That progress feeds ONE
   authoritative angle: target (scroll) → frame-rate-correct damping →
   rendered rotation. Nothing else writes `drum.rotation.y`, so the
   same scroll position always resolves to the same rotation. The
   camera rides the same progress on a Catmull-Rom path — continuous
   velocity, no start/stop pumping.

   Rendering is gated by an IntersectionObserver, the textures are
   generated locally (no third-party imagery, no async race), and
   reduced motion gets one hand-placed static frame instead of a loop.
   ============================================================= */

import { useEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import {
  Camera,
  Cylinder,
  Mesh,
  Program,
  Renderer,
  Texture,
  Transform,
} from 'ogl'

import usePrefersReducedMotion from '../../hooks/usePrefersReducedMotion.js'
import { adSlot } from '../../data/demo.js'

gsap.registerPlugin(ScrollTrigger)

/* -------------------------------------------------------------
   Logo marks — real vector paths, painted with Path2D.
   Simple-icons geometry (24 viewBox) for the ecosystem brands,
   the OpenCode blocky O (36×42) from its own asset and a green
   'aider' wordmark. No two-letter monogram boxes anywhere on
   the drum.
   ------------------------------------------------------------- */
const LOGO_PATHS = {
  claude: 'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z',
  openai: 'M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z',
  cline: 'm23.365 13.556-1.442-2.895V8.994c0-2.764-2.218-5.002-4.954-5.002h-2.464c.178-.367.276-.779.276-1.213A2.77 2.77 0 0 0 12.018 0a2.77 2.77 0 0 0-2.763 2.779c0 .434.098.846.276 1.213H7.067c-2.736 0-4.954 2.238-4.954 5.002v1.667L.64 13.549c-.149.29-.149.636 0 .927l1.472 2.855v1.667C2.113 21.762 4.33 24 7.067 24h9.902c2.736 0 4.954-2.238 4.954-5.002V17.33l1.44-2.865c.143-.286.143-.622.002-.91m-12.854 2.36a2.27 2.27 0 0 1-2.261 2.273 2.27 2.27 0 0 1-2.261-2.273v-4.042A2.27 2.27 0 0 1 8.249 9.6a2.267 2.267 0 0 1 2.262 2.274zm7.285 0a2.27 2.27 0 0 1-2.26 2.273 2.27 2.27 0 0 1-2.262-2.273v-4.042A2.267 2.267 0 0 1 15.535 9.6a2.267 2.267 0 0 1 2.261 2.274z',
  gemini: 'M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81',
  copilot: 'M23.922 16.997C23.061 18.492 18.063 22.02 12 22.02 5.937 22.02.939 18.492.078 16.997A.641.641 0 0 1 0 16.741v-2.869a.883.883 0 0 1 .053-.22c.372-.935 1.347-2.292 2.605-2.656.167-.429.414-1.055.644-1.517a10.098 10.098 0 0 1-.052-1.086c0-1.331.282-2.499 1.132-3.368.397-.406.89-.717 1.474-.952C7.255 2.937 9.248 1.98 11.978 1.98c2.731 0 4.767.957 6.166 2.093.584.235 1.077.546 1.474.952.85.869 1.132 2.037 1.132 3.368 0 .368-.014.733-.052 1.086.23.462.477 1.088.644 1.517 1.258.364 2.233 1.721 2.605 2.656a.841.841 0 0 1 .053.22v2.869a.641.641 0 0 1-.078.256Zm-11.75-5.992h-.344a4.359 4.359 0 0 1-.355.508c-.77.947-1.918 1.492-3.508 1.492-1.725 0-2.989-.359-3.782-1.259a2.137 2.137 0 0 1-.085-.104L4 11.746v6.585c1.435.779 4.514 2.179 8 2.179 3.486 0 6.565-1.4 8-2.179v-6.585l-.098-.104s-.033.045-.085.104c-.793.9-2.057 1.259-3.782 1.259-1.59 0-2.738-.545-3.508-1.492a4.359 4.359 0 0 1-.355-.508Zm2.328 3.25c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm-5 0c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm3.313-6.185c.136 1.057.403 1.913.878 2.497.442.544 1.134.938 2.344.938 1.573 0 2.292-.337 2.657-.751.384-.435.558-1.15.558-2.361 0-1.14-.243-1.847-.705-2.319-.477-.488-1.319-.862-2.824-1.025-1.487-.161-2.192.138-2.533.529-.269.307-.437.808-.438 1.578v.021c0 .265.021.562.063.893Zm-1.626 0c.042-.331.063-.628.063-.894v-.02c-.001-.77-.169-1.271-.438-1.578-.341-.391-1.046-.69-2.533-.529-1.505.163-2.347.537-2.824 1.025-.462.472-.705 1.179-.705 2.319 0 1.211.175 1.926.558 2.361.365.414 1.084.751 2.657.751 1.21 0 1.902-.394 2.344-.938.475-.584.742-1.44.878-2.497Z',
  ollama: 'M16.361 10.26a.894.894 0 0 0-.558.47l-.072.148.001.207c0 .193.004.217.059.353.076.193.152.312.291.448.24.238.51.3.872.205a.86.86 0 0 0 .517-.436.752.752 0 0 0 .08-.498c-.064-.453-.33-.782-.724-.897a1.06 1.06 0 0 0-.466 0zm-9.203.005c-.305.096-.533.32-.65.639a1.187 1.187 0 0 0-.06.52c.057.309.31.59.598.667.362.095.632.033.872-.205.14-.136.215-.255.291-.448.055-.136.059-.16.059-.353l.001-.207-.072-.148a.894.894 0 0 0-.565-.472 1.02 1.02 0 0 0-.474.007Zm4.184 2c-.131.071-.223.25-.195.383.031.143.157.288.353.407.105.063.112.072.117.136.004.038-.01.146-.029.243-.02.094-.036.194-.036.222.002.074.07.195.143.253.064.052.076.054.255.059.164.005.198.001.264-.03.169-.082.212-.234.15-.525-.052-.243-.042-.28.087-.355.137-.08.281-.219.324-.314a.365.365 0 0 0-.175-.48.394.394 0 0 0-.181-.033c-.126 0-.207.03-.355.124l-.085.053-.053-.032c-.219-.13-.259-.145-.391-.143a.396.396 0 0 0-.193.032zm.39-2.195c-.373.036-.475.05-.654.086-.291.06-.68.195-.951.328-.94.46-1.589 1.226-1.787 2.114-.04.176-.045.234-.045.53 0 .294.005.357.043.524.264 1.16 1.332 2.017 2.714 2.173.3.033 1.596.033 1.896 0 1.11-.125 2.064-.727 2.493-1.571.114-.226.169-.372.22-.602.039-.167.044-.23.044-.523 0-.297-.005-.355-.045-.531-.288-1.29-1.539-2.304-3.072-2.497a6.873 6.873 0 0 0-.855-.031zm.645.937a3.283 3.283 0 0 1 1.44.514c.223.148.537.458.671.662.166.251.26.508.303.82.02.143.01.251-.043.482-.08.345-.332.705-.672.957a3.115 3.115 0 0 1-.689.348c-.382.122-.632.144-1.525.138-.582-.006-.686-.01-.853-.042-.57-.107-1.022-.334-1.35-.68-.264-.28-.385-.535-.45-.946-.03-.192.025-.509.137-.776.136-.326.488-.73.836-.963.403-.269.934-.46 1.422-.512.187-.02.586-.02.773-.002zm-5.503-11a1.653 1.653 0 0 0-.683.298C5.617.74 5.173 1.666 4.985 2.819c-.07.436-.119 1.04-.119 1.503 0 .544.064 1.24.155 1.721.02.107.031.202.023.208a8.12 8.12 0 0 1-.187.152 5.324 5.324 0 0 0-.949 1.02 5.49 5.49 0 0 0-.94 2.339 6.625 6.625 0 0 0-.023 1.357c.091.78.325 1.438.727 2.04l.13.195-.037.064c-.269.452-.498 1.105-.605 1.732-.084.496-.095.629-.095 1.294 0 .67.009.803.088 1.266.095.555.288 1.143.503 1.534.071.128.243.393.264.407.007.003-.014.067-.046.141a7.405 7.405 0 0 0-.548 1.873c-.062.417-.071.552-.071.991 0 .56.031.832.148 1.279L3.42 24h1.478l-.05-.091c-.297-.552-.325-1.575-.068-2.597.117-.472.25-.819.498-1.296l.148-.29v-.177c0-.165-.003-.184-.057-.293a.915.915 0 0 0-.194-.25 1.74 1.74 0 0 1-.385-.543c-.424-.92-.506-2.286-.208-3.451.124-.486.329-.918.544-1.154a.787.787 0 0 0 .223-.531c0-.195-.07-.355-.224-.522a3.136 3.136 0 0 1-.817-1.729c-.14-.96.114-2.005.69-2.834.563-.814 1.353-1.336 2.237-1.475.199-.033.57-.028.776.01.226.04.367.028.512-.041.179-.085.268-.19.374-.431.093-.215.165-.333.36-.576.234-.29.46-.489.822-.729.413-.27.884-.467 1.352-.561.17-.035.25-.04.569-.04.319 0 .398.005.569.04a4.07 4.07 0 0 1 1.914.997c.117.109.398.457.488.602.034.057.095.177.132.267.105.241.195.346.374.43.14.068.286.082.503.045.343-.058.607-.053.943.016 1.144.23 2.14 1.173 2.581 2.437.385 1.108.276 2.267-.296 3.153-.097.15-.193.27-.333.419-.301.322-.301.722-.001 1.053.493.539.801 1.866.708 3.036-.062.772-.26 1.463-.533 1.854a2.096 2.096 0 0 1-.224.258.916.916 0 0 0-.194.25c-.054.109-.057.128-.057.293v.178l.148.29c.248.476.38.823.498 1.295.253 1.008.231 2.01-.059 2.581a.845.845 0 0 0-.044.098c0 .006.329.009.732.009h.73l.02-.074.036-.134c.019-.076.057-.3.088-.516.029-.217.029-1.016 0-1.258-.11-.875-.295-1.57-.597-2.226-.032-.074-.053-.138-.046-.141.008-.005.057-.074.108-.152.376-.569.607-1.284.724-2.228.031-.26.031-1.378 0-1.628-.083-.645-.182-1.082-.348-1.525a6.083 6.083 0 0 0-.329-.7l-.038-.064.131-.194c.402-.604.636-1.262.727-2.04a6.625 6.625 0 0 0-.024-1.358 5.512 5.512 0 0 0-.939-2.339 5.325 5.325 0 0 0-.95-1.02 8.097 8.097 0 0 1-.186-.152.692.692 0 0 1 .023-.208c.208-1.087.201-2.443-.017-3.503-.19-.924-.535-1.658-.98-2.082-.354-.338-.716-.482-1.15-.455-.996.059-1.8 1.205-2.116 3.01a6.805 6.805 0 0 0-.097.726c0 .036-.007.066-.015.066a.96.96 0 0 1-.149-.078A4.857 4.857 0 0 0 12 3.03c-.832 0-1.687.243-2.456.698a.958.958 0 0 1-.148.078c-.008 0-.015-.03-.015-.066a6.71 6.71 0 0 0-.097-.725C8.997 1.392 8.337.319 7.46.048a2.096 2.096 0 0 0-.585-.041Zm.293 1.402c.248.197.523.759.682 1.388.03.113.06.244.069.292.007.047.026.152.041.233.067.365.098.76.102 1.24l.002.475-.12.175-.118.178h-.278c-.324 0-.646.041-.954.124l-.238.06c-.033.007-.038-.003-.057-.144a8.438 8.438 0 0 1 .016-2.323c.124-.788.413-1.501.696-1.711.067-.05.079-.049.157.013zm9.825-.012c.17.126.358.46.498.888.28.854.36 2.028.212 3.145-.019.14-.024.151-.057.144l-.238-.06a3.693 3.693 0 0 0-.954-.124h-.278l-.119-.178-.119-.175.002-.474c.004-.669.066-1.19.214-1.772.157-.623.434-1.185.68-1.382.078-.062.09-.063.159-.012z',
}

const OPENCODE_PATHS = [
  { d: 'M18 30H6V18H18V30Z', fill: '#4B4646' },
  { d: 'M18 12H6V30H18V12ZM24 36H0V6H24V36Z', fill: '#B7B1B1' },
]

const logoPathCache = {}
function logoPath(key) {
  if (!logoPathCache[key]) logoPathCache[key] = new Path2D(LOGO_PATHS[key])
  return logoPathCache[key]
}

/* Paint one mark centred inside a box of `box` px. */
function drawLogoMark(ctx, kind, bx, by, box) {
  if (kind === 'opencode') {
    /* OpenCode's blocky O — two stacked paths, light frame over
       dark core, exactly as the brand asset ships (36×42). */
    const s = (box * 0.94) / 42
    ctx.save()
    ctx.translate(bx + (box - 36 * s) / 2, by + (box - 42 * s) / 2)
    ctx.scale(s, s)
    const core = new Path2D(OPENCODE_PATHS[0].d)
    const frame = new Path2D(OPENCODE_PATHS[1].d)
    ctx.fillStyle = OPENCODE_PATHS[0].fill
    ctx.fill(core)
    ctx.fillStyle = OPENCODE_PATHS[1].fill
    ctx.fill(frame, 'evenodd')
    ctx.restore()
    return
  }
  if (kind === 'aider') {
    /* The Aider wordmark — green, lowercase, fitted to the box. */
    let size = 34
    ctx.font = `700 ${size}px "Space Grotesk", system-ui, sans-serif`
    while (ctx.measureText('aider').width > box - 4 && size > 16) {
      size -= 1
      ctx.font = `700 ${size}px "Space Grotesk", system-ui, sans-serif`
    }
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#14B014'
    ctx.fillText('aider', bx + box / 2, by + box / 2 + 1)
    ctx.textBaseline = 'alphabetic'
    ctx.textAlign = 'left'
    return
  }

  /* Standard 24-viewBox vector marks — simple-icons geometry,
     each in its own brand colour against the black panel. */
  const s = (box * 0.92) / 24
  ctx.save()
  ctx.translate(bx + (box - 24 * s) / 2, by + (box - 24 * s) / 2)
  ctx.scale(s, s)
  const fills = {
    claude: '#D97757',
    openai: '#ffffff',
    cline: '#ffffff',
    gemini: '#5B8DEF',
    copilot: '#ffffff',
    ollama: '#ffffff',
  }
  ctx.fillStyle = fills[kind] || '#ffffff'
  ctx.fill(logoPath(kind))
  ctx.restore()
}

/* The surfaces wrapped around the drum, in order. Each tool keeps
   its own chrome — the identity treatment, transcript frame, input
   style and free status strip its real interface has — so the drum
   reads as eight different programs, not one card repeated.
   `chrome` picks the painter, `ui` carries the strings that
   interface shows, `ad` says whether the free strip holds a
   permanent placement or a slot that opens only after stdout
   finishes printing, and every tool's free strip carries an ad.
   Logo marks are canvas vector paths: simple-icons geometry for
   the ecosystem brands (Anthropic, OpenAI, Cline, Gemini, GitHub,
   Ollama), the OpenCode blocky O (36×42) from its own asset, and
   a green 'aider' wordmark. */
const SURFACES = [
  {
    index: '01',
    name: 'CLAUDE CODE',
    logo: 'claude',
    category: 'AI CODING AGENT',
    provider: 'ANTHROPIC',
    chrome: 'claude',
    ad: { mode: 'permanent' },
    command: '$ claude',
    lines: [
      '> inspecting repository',
      '> reading src/',
      '> analyzing dependencies',
      '> planning changes',
      '✓ implementation ready',
    ],
    ui: {
      input: 'How can I help you today?',
      status: 'sonnet · 52k/200k',
      hint: 'esc to interrupt · ? for shortcuts',
    },
    status: 'ACTIVE',
  },
  {
    index: '02',
    name: 'CODEX',
    logo: 'openai',
    category: 'CODING AGENT',
    provider: 'OPENAI',
    chrome: 'codex',
    ad: { mode: 'permanent' },
    command: '$ codex',
    lines: [
      '> loading workspace',
      '> inspecting files',
      '> running analysis',
      '> generating patch',
      '✓ patch ready',
    ],
    ui: {
      model: 'model: gpt-5.6-sol medium',
      hint: '100% context left · ? for shortcuts',
      input: 'instructions',
    },
    status: 'READY',
  },
  {
    index: '03',
    name: 'CLINE',
    logo: 'cline',
    category: 'VS CODE AGENT',
    provider: 'CLINE',
    chrome: 'cline',
    ad: { mode: 'permanent' },
    command: null,
    lines: [
      '> initializing agent',
      '> reading project',
      '> selecting tools',
      '> executing task',
      '✓ task completed',
    ],
    ui: {
      mode: 'ACT',
      input: 'Describe the task',
      status: 'Sonnet 4.5 · $0.012 · 12k',
      ctx: '12k/200k',
      hint: 'auto-approve on · plan/act · mcp +3',
    },
    status: 'ACTIVE',
  },
  {
    index: '04',
    name: 'OPENCODE',
    logo: 'opencode',
    category: 'TERMINAL AGENT',
    provider: 'OPEN SOURCE',
    chrome: 'opencode',
    ad: { mode: 'permanent' },
    command: '$ opencode',
    lines: [
      '> loading project',
      '> reading source',
      '> analyzing components',
      '> running tests',
      '✓ checks passed',
    ],
    ui: {
      strip: 'build · qwen3-coder · 14:32',
      input: 'send a message',
      hint: '/commands · ctrl+o files · esc quit',
    },
    status: 'READY',
  },
  {
    index: '05',
    name: 'GEMINI CLI',
    logo: 'gemini',
    category: 'AI CODING AGENT',
    provider: 'GOOGLE',
    chrome: 'gemini',
    ad: { mode: 'permanent' },
    command: '$ gemini',
    lines: [
      '> indexing repository',
      '> drafting summary',
      '> checking references',
      '> refining answer',
      '✓ response ready',
    ],
    ui: {
      quota: '60/min · 1000/day · 5% ctx',
      input: 'How can I help?',
      hint: 'free tier · /help · /tools',
    },
    status: 'READY',
  },
  {
    index: '06',
    name: 'AIDER',
    logo: 'aider',
    category: 'PAIR PROGRAMMING',
    provider: 'OPEN SOURCE',
    chrome: 'aider',
    ad: { mode: 'permanent' },
    command: '$ aider',
    lines: [
      '> scanning codebase',
      '> proposing edit',
      '> applying diff',
      '> running checks',
      '✓ committed to git',
    ],
    ui: {
      banner: 'v0.81 · main: sonnet · repo-map 1024',
      tokens: '11,740 sent · $0.08 session',
      input: 'ask anything · /commands',
      hint: 'repo-map 1024 · git: main · auto-commits',
    },
    status: 'ACTIVE',
  },
  {
    index: '07',
    name: 'COPILOT CLI',
    logo: 'copilot',
    category: 'CODE SUGGESTIONS',
    provider: 'GITHUB',
    chrome: 'copilot',
    ad: { mode: 'permanent' },
    command: '$ copilot',
    lines: [
      '> loading context',
      '> reading diffs',
      '> suggesting tests',
      '> streaming candidates',
      '✓ suggestions ready',
    ],
    ui: {
      tabs: ['Session', 'Issues', 'PRs', 'Gists'],
      usage: '144/300 requests',
      model: 'Using Sonnet 4.5',
      input: 'Describe your task',
      hint: '! shell · /usage · /login',
    },
    status: 'READY',
  },
  {
    index: '08',
    name: 'LOCAL / SELF-HOSTED',
    logo: 'ollama',
    category: 'LOCAL RUNTIME',
    provider: 'OLLAMA · LLAMA.CPP',
    chrome: 'shell',
    ad: { mode: 'deferred' },
    command: '$ ollama run llama3.1:70b',
    lines: [
      '> loading llama3.1:70b',
      '> warming context',
      '> generating offline',
      '> private / no egress',
      '✓ model ready',
    ],
    ui: {
      hint: 'bare shell · no idle chrome · slot opens after stdout',
    },
    status: 'READY',
  },
]

/* -------------------------------------------------------------
   The palette the drum is built from — CLIRevenue's locked system:
   black surfaces, white ink, one red accent. Nothing else is a
   colour. Red marks instrumentation (rule head, prompt glyphs,
   status dot, the placement's leading tick).
   ------------------------------------------------------------- */
const INK = '#ffffff' /* titles and marks */
const SUB = '#ffffff' /* primary text — brand, command, status */
const DIM = 'rgba(255, 255, 255, 0.78)' /* secondary text — terminal output */
const FAINT = 'rgba(255, 255, 255, 0.6)' /* micro metadata */
const HAIR = 'rgba(255, 255, 255, 0.45)' /* borders, frames */
const VOID = '#000000' /* page black */
const AMBER = '#ff1f2d' /* the single accent — red */

/* Geometry: eight surfaces share a circumference of 2πr, so a radius of
   3 against a height of 2.6 gives each wrapped surface a tall,
   generous card — flatter under perspective, easier to read front-on,
   while the sides still visibly curve away. */
const RADIUS = 3.0
const HEIGHT = 2.6
/* Virtual tile canvas the atlas painters lay out in (real pixels are
   this box, scaled to whatever the GPU's texture limit allows). */
const TILE_W = 512
const TILE_H = 706
/* Rotation budget across the pinned sequence: 0.90 of a revolution
   over 1360vh — every surface (through LOCAL / SELF-HOSTED at index
   7) reaches dead front, yet deg-per-pixel stays low: scroll turns
   the drum like a mechanical selector, never a spin. Eight panels,
   45° apart. */
const TURNS = 0.9
/* Damping constant (per second) of the single follow step:
   target → damped → rendered. ~0.2s settle: a heavy mechanism, and
   high-frequency scroll jitter is filtered out before it reaches the
   glass. */
const DAMP = 5.0

/* The camera's cinematic journey across the pinned stage: LARGE on
   entry (the drum owns the frame — never a small object in a void),
   closing to the hero plateau where the front panel owns roughly half
   the cylinder's width, a gentle off-axis orbit through the hold, and
   only a restrained pull-back for the release so the cylinder stays
   the major visual all the way out. */
const CAMERA_KEYS = [
  { p: 0.0, pos: [0.0, 0.38, 10.5], look: [0, 0.05, 0] },
  { p: 0.25, pos: [0.25, 0.5, 6.7], look: [0, 0.08, 0] },
  { p: 0.5, pos: [0.5, 0.55, 6.3], look: [0, 0.0, 0] },
  { p: 0.75, pos: [-0.45, 0.6, 6.3], look: [0, 0.0, 0] },
  { p: 0.9, pos: [0.1, 0.66, 7.2], look: [0, 0.05, 0] },
  { p: 1.0, pos: [0.0, 0.9, 9.4], look: [0, 0.08, 0] },
]

/* Scale over progress: hero entry 0.88 → 1 by ~0.18 (large from the
   first frame; the enlargement happens EARLY), held dead stable
   through the pinned rotation, a barely-there recession in the last
   tenth so the release never snaps — the cylinder stays big. */
function scaleAt(p) {
  const q = clamp01(p)
  if (q < 0.18) return lerp(0.88, 1.0, smoothstep(q / 0.18))
  if (q < 0.9) return 1.0
  return lerp(1.0, 0.94, smoothstep((q - 0.9) / 0.1))
}

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n)
const smoothstep = (t) => t * t * (3 - 2 * t)
const lerp = (a, b, t) => a + (b - a) * t

/* Rest the drum with tile 01 near the centre of the opening view
   (the 0.5-panel PHASE offset), and fix reduced motion on a
   hand-placed frame where OPENCODE sits front with its full terminal
   sequence printed (f = 4 + 30/45 → p·TURNS·N + 0.5 = 4.667). */
const PHASE = -Math.PI / SURFACES.length
const STATIC_P = (4.667 - 0.5) / (TURNS * SURFACES.length)

/* Uniform Catmull-Rom through four control points. The camera path
   uses this instead of per-segment smoothstep so velocity is
   continuous across keys — no arriving-and-stopping at each one. */
function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t
  const t3 = t2 * t
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  )
}

/* Walk the camera keys with Catmull-Rom between neighbours.
   Returns [px, py, pz, lx, ly, lz]. */
function sampleCamera(p) {
  const q = clamp01(p)
  const keys = CAMERA_KEYS
  let i = 0
  while (i < keys.length - 2 && q > keys[i + 1].p) i += 1
  const span = keys[i + 1].p - keys[i].p || 1
  const t = clamp01((q - keys[i].p) / span)
  const a = keys[Math.max(0, i - 1)]
  const b = keys[i]
  const c = keys[i + 1]
  const d = keys[Math.min(keys.length - 1, i + 2)]
  return [
    catmull(a.pos[0], b.pos[0], c.pos[0], d.pos[0], t),
    catmull(a.pos[1], b.pos[1], c.pos[1], d.pos[1], t),
    catmull(a.pos[2], b.pos[2], c.pos[2], d.pos[2], t),
    catmull(a.look[0], b.look[0], c.look[0], d.look[0], t),
    catmull(a.look[1], b.look[1], c.look[1], d.look[1], t),
    catmull(a.look[2], b.look[2], c.look[2], d.look[2], t),
  ]
}

/* -------------------------------------------------------------
   The atlas.
   -------------------------------------------------------------
   One canvas, SURFACES.length tiles wide, painted as premium
   terminal cards: vector logo, tool name, brand, a terminal
   screen with the real command and output, status. Generated
   in-page, so the drum never waits on a network image. All painters lay out in a
   virtual TILE_W×TILE_H space; the canvas is scaled to fit the
   GPU's texture limit. */

function wrapText(ctx, text, x, y, maxW, lh) {
  const words = text.split(' ')
  let line = ''
  let cy = y
  words.forEach((word, wi) => {
    const probe = line ? `${line} ${word}` : word
    if (ctx.measureText(probe).width > maxW && line) {
      ctx.fillText(line, x, cy)
      cy += lh
      line = word
    } else {
      line = probe
    }
    if (wi === words.length - 1 && line) ctx.fillText(line, x, cy)
  })
  return cy + lh
}

function panelBase(ctx, x, y, w, h) {
  /* Pure black. The drum emerges from the page's own black — no
     graphite steps, no gradient that could read as a gray wash. */
  ctx.fillStyle = '#000000'
  ctx.fillRect(x, y, w, h)

  /* Vertical structure only — the machined-panel read. Horizontal
     rows were removed: they sliced every surface into bands. */
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)'
  ctx.lineWidth = 1
  for (let gx = x + 64; gx < x + w; gx += 64) {
    ctx.beginPath()
    ctx.moveTo(gx, y)
    ctx.lineTo(gx, y + h)
    ctx.stroke()
  }

  /* Frame, plus a hairline inset. */
  ctx.strokeStyle = HAIR
  ctx.lineWidth = 2
  ctx.strokeRect(x + 12, y + 12, w - 24, h - 24)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)'
  ctx.lineWidth = 1
  ctx.strokeRect(x + 24, y + 24, w - 48, h - 48)

  /* Corner ticks — two corners only. */
  ctx.fillStyle = FAINT
  ctx.fillRect(x + 12, y + 12, 30, 3)
  ctx.fillRect(x + 12, y + 12, 3, 30)
  ctx.fillRect(x + w - 42, y + h - 15, 30, 3)
  ctx.fillRect(x + w - 15, y + h - 45, 3, 30)
}

/* -------------------------------------------------------------
   Per-CLI chrome painters.
   Every surface keeps the drum's shared instrumentation — the
   index/category rail up top, the STATUS footer at the bottom —
   but between them each tool is painted the way its real
   interface is laid out: its identity treatment, its transcript
   frame, its input style, and the free status strip where a
   placement lives. `drawStripAd` fills that strip permanently;
   `drawDeferredBand` holds an inert reserved slot that only
   fills with the ad once stdout has finished printing (ev >=
   total). Radius 0 everywhere; red only marks disclosure.
   ------------------------------------------------------------- */
const MONO = '"IBM Plex Mono", ui-monospace, monospace'
const SANS = '"Space Grotesk", system-ui, sans-serif'

/* Shrink-to-fit: returns `text` (possibly ellipsised) measured
   inside maxW, at the largest font ≤ size that fits. Leaves
   ctx.font at the final size. Measurement is safe under a live
   `letterSpacing`: the canvas spec excludes letter spacing from
   measureText, so every measurement resets it to 0 and restores
   it after — a tracked label would otherwise shrink past its
   real width and render loose. */
function fitText(ctx, text, maxW, weight, size, minSize, family) {
  let s = size
  let out = String(text)
  const tracked = ctx.letterSpacing && ctx.letterSpacing !== '0px'
  if (tracked) ctx.letterSpacing = '0px'
  ctx.font = `${weight} ${s}px ${family}`
  while (ctx.measureText(out).width > maxW && s > minSize) {
    s -= 1
    ctx.font = `${weight} ${s}px ${family}`
  }
  if (ctx.measureText(out).width > maxW) {
    while (ctx.measureText(`${out}…`).width > maxW && out.length > 4) {
      out = out.slice(0, -1)
    }
    out = `${out}…`
  }
  ctx.font = `${weight} ${s}px ${family}`
  if (tracked) ctx.letterSpacing = tracked
  return out
}

/* Shared rail: index left, category right. */
function drawRail(ctx, surface, y, left, right) {
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.fillStyle = DIM
  ctx.font = `600 22px ${MONO}`
  ctx.fillText(surface.index, left, y + 70)
  ctx.textAlign = 'right'
  ctx.fillStyle = FAINT
  ctx.letterSpacing = '0.14em'
  ctx.font = `500 14px ${MONO}`
  ctx.fillText(surface.category, right, y + 70)
  ctx.letterSpacing = '0px'
  ctx.textAlign = 'left'
}

/* Shared footer: status dot + STATUS / X, position in the set. */
function drawDrumFooter(ctx, surface, y, h, left, right) {
  ctx.fillStyle = AMBER
  ctx.beginPath()
  ctx.arc(left + 5, y + h - 53, 5, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = SUB
  ctx.font = `600 16px ${MONO}`
  ctx.fillText(`STATUS / ${surface.status}`, left + 18, y + h - 48)
  ctx.textAlign = 'right'
  ctx.fillStyle = FAINT
  ctx.font = `500 15px ${MONO}`
  ctx.fillText(
    `${surface.index} / ${String(SURFACES.length).padStart(2, '0')}`,
    right,
    y + h - 48,
  )
  ctx.textAlign = 'left'
}

/* The tool's real invocation, red sigil. */
function printCommand(ctx, command, x, y, size) {
  ctx.font = `600 ${size}px ${MONO}`
  ctx.fillStyle = AMBER
  ctx.fillText('$', x, y)
  const textX = x + ctx.measureText('$').width + 6
  ctx.fillStyle = SUB
  ctx.fillText(command.slice(1), textX, y)
}

/* Transcript printing — each line appears only once its scroll
   event has been reached. `glyph` replaces the data's '>' marker
   (null renders the step line as plain text, Aider style). */
function printLines(ctx, surface, count, x, y0, lineH, glyph, size, maxW) {
  surface.lines.slice(0, count).forEach((line, li) => {
    const ty = y0 + li * lineH
    const isStep = line.startsWith('>')
    const isDone = !isStep && line.startsWith('✓')
    const body = isStep ? line.slice(1) : line
    let fs = size
    let gW = 0
    const setBodyFont = () => {
      ctx.font = `400 ${fs}px ${MONO}`
      if (isStep && glyph) {
        ctx.font = `600 ${fs}px ${MONO}`
        gW = ctx.measureText(glyph).width + 8
        ctx.font = `400 ${fs}px ${MONO}`
      }
    }
    setBodyFont()
    while (ctx.measureText(body).width > maxW - gW && fs > 12) {
      fs -= 1
      setBodyFont()
    }
    if (isStep && glyph) {
      ctx.fillStyle = AMBER
      ctx.font = `600 ${fs}px ${MONO}`
      ctx.fillText(glyph, x, ty)
      ctx.font = `400 ${fs}px ${MONO}`
    }
    if (isDone) ctx.fillStyle = SUB
    else if (isStep) ctx.fillStyle = li === 0 ? SUB : DIM
    else ctx.fillStyle = DIM
    ctx.fillText(body, x + gW, ty)
  })
}

/* Bordered input box — the shape Claude Code, OpenCode, Gemini,
   Copilot and Cline all put under their transcript. */
function drawInputBox(ctx, x, y, w, h, glyph, placeholder, hint) {
  ctx.fillStyle = '#000000'
  ctx.fillRect(x, y, w, h)
  ctx.strokeStyle = HAIR
  ctx.lineWidth = 1.5
  ctx.strokeRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5)
  const baseY = y + h / 2 + 5
  let textX = x + 14
  if (glyph) {
    ctx.fillStyle = AMBER
    ctx.font = `600 15px ${MONO}`
    ctx.fillText(glyph, textX, baseY)
    textX += ctx.measureText(glyph).width + 8
  }
  ctx.fillStyle = FAINT
  ctx.font = `400 14px ${MONO}`
  ctx.fillText(placeholder, textX, baseY)
  if (hint) {
    ctx.textAlign = 'right'
    ctx.fillStyle = FAINT
    ctx.font = `500 11px ${MONO}`
    ctx.fillText(hint, x + w - 14, baseY)
    ctx.textAlign = 'left'
  }
}

/* Permanent strip ad — lives in the free half of a CLI's status
   strip (h = 40): disclosure chip on the right, SPONSORED ·
   advertiser rail over the headline on the left, one red tick
   at the leading edge. Always drawn, regardless of print state. */
function drawStripAd(ctx, x, y, w, h, slot) {
  ctx.fillStyle = '#000000'
  ctx.fillRect(x, y, w, h)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)'
  ctx.lineWidth = 1
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
  ctx.fillStyle = AMBER
  ctx.fillRect(x, y, 3, h)

  const padL = x + 11
  const padR = x + w - 8

  const chipText = String(slot.disclosure).toUpperCase()
  ctx.font = `600 9px ${MONO}`
  const chipW = ctx.measureText(chipText).width + 12
  const chipY = Math.round(y + (h - 16) / 2)
  ctx.fillStyle = AMBER
  ctx.fillRect(padR - chipW, chipY, chipW, 16)
  ctx.fillStyle = '#000000'
  ctx.fillText(chipText, padR - chipW + 6, chipY + 12)

  const textW = padR - chipW - 12 - padL

  ctx.letterSpacing = '0.18em'
  ctx.font = `600 10px ${MONO}`
  ctx.fillStyle = AMBER
  ctx.fillText('SPONSORED', padL, y + 17)
  const labW = ctx.measureText('SPONSORED').width

  ctx.letterSpacing = '0.08em'
  ctx.font = `500 10px ${MONO}`
  ctx.fillStyle = FAINT
  const advAvail = textW - labW - 8
  let adv = `· ${String(slot.advertiser).toUpperCase()}`
  while (ctx.measureText(adv).width > advAvail && adv.length > 4) {
    adv = adv.slice(0, -1)
  }
  ctx.fillText(adv, padL + labW + 8, y + 17)
  ctx.letterSpacing = '0px'

  ctx.fillStyle = INK
  const hl = fitText(ctx, slot.headline, textW, '600', 12, 9, SANS)
  ctx.fillText(hl, padL, y + 33)
}

/* Box ad — the taller placement for a free region with real
   height (Codex's splash box right half): rail, brand, headline,
   disclosure chip and not-stdout echo. */
function drawBoxAd(ctx, x, y, w, h, slot) {
  ctx.fillStyle = '#000000'
  ctx.fillRect(x, y, w, h)
  ctx.strokeStyle = HAIR
  ctx.lineWidth = 1
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
  ctx.fillStyle = AMBER
  ctx.fillRect(x, y, w, 3)

  const pad = 12
  const tx = x + pad
  const tw = w - pad * 2

  ctx.letterSpacing = '0.18em'
  ctx.font = `600 10px ${MONO}`
  ctx.fillStyle = AMBER
  ctx.fillText('SPONSORED', tx, y + 26)
  ctx.letterSpacing = '0.2em'
  ctx.font = `500 10px ${MONO}`
  ctx.fillStyle = FAINT
  ctx.textAlign = 'right'
  ctx.fillText('AD', x + w - pad, y + 26)
  ctx.textAlign = 'left'
  ctx.letterSpacing = '0px'

  ctx.letterSpacing = '0.14em'
  ctx.font = `700 15px ${SANS}`
  ctx.fillStyle = INK
  ctx.fillText(String(slot.brand).toUpperCase(), tx, y + 52)
  ctx.letterSpacing = '0px'

  ctx.fillStyle = DIM
  ctx.font = `600 13px ${SANS}`
  wrapText(ctx, slot.headline, tx, y + 74, tw, 18)

  const chipText = String(slot.disclosure).toUpperCase()
  ctx.font = `600 9px ${MONO}`
  const chipW = ctx.measureText(chipText).width + 12
  const chipY = y + h - 24
  ctx.fillStyle = AMBER
  ctx.fillRect(tx, chipY, chipW, 16)
  ctx.fillStyle = '#000000'
  ctx.fillText(chipText, tx + 6, chipY + 12)
  ctx.textAlign = 'right'
  ctx.letterSpacing = '0.1em'
  ctx.font = `500 9px ${MONO}`
  ctx.fillStyle = FAINT
  ctx.fillText('NOT STDOUT', x + w - pad, chipY + 12)
  ctx.letterSpacing = '0px'
  ctx.textAlign = 'left'
}

/* Deferred band — a bare terminal has no idle chrome strip, so
   the placement waits: until stdout finishes (ready) the band
   stays inert, framed and labelled; then the ad fills it. */
function drawDeferredBand(ctx, x, y, w, h, slot, ready) {
  if (!ready) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)'
    ctx.lineWidth = 1
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)'
    ctx.fillRect(x + 1, y + 1, 16, 2)
    ctx.fillRect(x + 1, y + 1, 2, 16)
    ctx.fillRect(x + w - 17, y + h - 3, 16, 2)
    ctx.fillRect(x + w - 3, y + h - 17, 2, 16)
    ctx.fillStyle = FAINT
    ctx.letterSpacing = '0.14em'
    const label = fitText(
      ctx,
      'SPONSORED SLOT · OPENS WHEN OUTPUT COMPLETES',
      w - 32,
      '500',
      11,
      8,
      MONO,
    )
    ctx.fillText(label, x + 16, y + h / 2 + 4)
    ctx.letterSpacing = '0px'
    return
  }

  ctx.fillStyle = '#000000'
  ctx.fillRect(x, y, w, h)
  ctx.strokeStyle = HAIR
  ctx.lineWidth = 1
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
  ctx.fillStyle = AMBER
  ctx.fillRect(x, y, w, 3)

  const tx = x + 16
  const tw = w - 32

  ctx.letterSpacing = '0.18em'
  ctx.font = `600 11px ${MONO}`
  ctx.fillStyle = AMBER
  ctx.fillText('SPONSORED', tx, y + 30)
  const labW = ctx.measureText('SPONSORED').width
  ctx.letterSpacing = '0.1em'
  ctx.font = `500 11px ${MONO}`
  ctx.fillStyle = FAINT
  ctx.fillText(` · ${String(slot.advertiser).toUpperCase()}`, tx + labW, y + 30)

  const chipText = String(slot.disclosure).toUpperCase()
  ctx.letterSpacing = '0px'
  ctx.font = `600 9px ${MONO}`
  const chipW = ctx.measureText(chipText).width + 12
  ctx.fillStyle = AMBER
  ctx.fillRect(x + w - 16 - chipW, y + 14, chipW, 16)
  ctx.fillStyle = '#000000'
  ctx.fillText(chipText, x + w - 16 - chipW + 6, y + 26)
  ctx.textAlign = 'right'
  ctx.letterSpacing = '0.2em'
  ctx.font = `500 10px ${MONO}`
  ctx.fillStyle = FAINT
  ctx.fillText('AD', x + w - 26 - chipW, y + 26)
  ctx.letterSpacing = '0px'
  ctx.textAlign = 'left'

  ctx.fillStyle = INK
  const hl = fitText(ctx, slot.headline, tw, '700', 17, 12, SANS)
  ctx.fillText(hl, tx, y + 64)

  ctx.letterSpacing = '0.12em'
  ctx.font = `500 10px ${MONO}`
  ctx.fillStyle = FAINT
  ctx.fillText(String(slot.region).toUpperCase(), tx, y + 88)
  ctx.textAlign = 'right'
  ctx.fillStyle = AMBER
  ctx.font = `600 10px ${MONO}`
  ctx.fillText(`${String(slot.action).toUpperCase()} ↗`, x + w - 16, y + 88)
  ctx.letterSpacing = '0px'
  ctx.textAlign = 'left'
}

/* --- 01 · Claude Code — text-forward header, unframed
   transcript, boxed input, custom status line with the free
   right half holding the placement. ------------------------- */
function drawClaudeTile(ctx, x, y, w, h, surface, ev) {
  const cmdOn = Boolean(surface.command) && ev >= 1
  const lineCount = surface.command ? Math.max(0, ev - 1) : ev
  const left = x + 42
  const right = x + w - 42
  const cw = right - left

  panelBase(ctx, x, y, w, h)
  drawRail(ctx, surface, y, left, right)

  const box = 54
  const bx = left
  const by = y + 92
  ctx.fillStyle = 'rgba(0, 0, 0, 0.85)'
  ctx.fillRect(bx, by, box, box)
  ctx.strokeStyle = HAIR
  ctx.lineWidth = 1.5
  ctx.strokeRect(bx + 0.75, by + 0.75, box - 1.5, box - 1.5)
  ctx.fillStyle = AMBER
  ctx.fillRect(bx + 7, by + 7, 12, 3)
  drawLogoMark(ctx, surface.logo, bx + 11, by + 14, 32)

  ctx.fillStyle = INK
  ctx.font = `700 30px ${SANS}`
  ctx.fillText(surface.name, left + 66, y + 126)
  ctx.fillStyle = FAINT
  ctx.letterSpacing = '0.14em'
  ctx.font = `500 13px ${MONO}`
  ctx.fillText(surface.provider, left + 66, y + 148)
  ctx.letterSpacing = '0px'

  ctx.fillStyle = AMBER
  ctx.fillRect(left, y + 166, 44, 3)
  ctx.fillStyle = HAIR
  ctx.fillRect(left + 44, y + 166, cw - 44, 1)

  if (cmdOn) printCommand(ctx, surface.command, left, y + 206, 17)
  /* 6 lines at 34px leading: the last baseline (y+410) must clear the
     composer box below (y+424) even when the transcript is complete —
     the box is painted after the lines, so overlap would erase text. */
  printLines(ctx, surface, lineCount, left, y + 240, 34, '⏺', 16, cw)

  drawInputBox(ctx, left, y + 424, cw, 48, null, surface.ui.input, '⏎')

  /* Status line: state on the left, placement in the free right. */
  ctx.fillStyle = FAINT
  ctx.font = `500 13px ${MONO}`
  ctx.fillText(surface.ui.status, left, y + 500)
  drawStripAd(ctx, left + 210, y + 476, cw - 210, 40, adSlot)

  ctx.fillStyle = FAINT
  ctx.letterSpacing = '0.06em'
  ctx.font = `500 12px ${MONO}`
  ctx.fillText(surface.ui.hint, left, y + 552)
  ctx.letterSpacing = '0px'

  drawDrumFooter(ctx, surface, y, h, left, right)
}

/* --- 02 · Codex — boxed splash with model/directory left and
   the placement in the splash's empty right half; unframed
   output; underline composer. ------------------------------ */
function drawCodexTile(ctx, x, y, w, h, surface, ev) {
  const cmdOn = Boolean(surface.command) && ev >= 1
  const lineCount = surface.command ? Math.max(0, ev - 1) : ev
  const left = x + 42
  const right = x + w - 42
  const cw = right - left

  panelBase(ctx, x, y, w, h)
  drawRail(ctx, surface, y, left, right)

  const sx = x + 24
  const sy = y + 92
  const sw = w - 48
  const sh = 156
  ctx.fillStyle = '#000000'
  ctx.fillRect(sx, sy, sw, sh)
  ctx.strokeStyle = HAIR
  ctx.lineWidth = 1.5
  ctx.strokeRect(sx + 0.75, sy + 0.75, sw - 1.5, sh - 1.5)
  ctx.fillStyle = FAINT
  ctx.fillRect(sx + 6, sy + 6, 14, 2)
  ctx.fillRect(sx + 6, sy + 6, 2, 14)
  ctx.fillRect(sx + sw - 20, sy + sh - 8, 14, 2)
  ctx.fillRect(sx + sw - 8, sy + sh - 20, 2, 14)

  /* Logo box — the splash's identity mark: OpenAI's blossom in
     the same framed treatment every other tile on the drum uses
     (black plate, hairline frame, red tick, real vector path). */
  const box = 44
  const bx = sx + 16
  const by = sy + 20
  ctx.fillStyle = 'rgba(0, 0, 0, 0.85)'
  ctx.fillRect(bx, by, box, box)
  ctx.strokeStyle = HAIR
  ctx.lineWidth = 1.5
  ctx.strokeRect(bx + 0.75, by + 0.75, box - 1.5, box - 1.5)
  ctx.fillStyle = AMBER
  ctx.fillRect(bx + 7, by + 7, 12, 3)
  drawLogoMark(ctx, surface.logo, bx + 8, by + 11, 28)

  ctx.fillStyle = INK
  ctx.font = `700 17px ${SANS}`
  ctx.fillText('OpenAI Codex', sx + 74, sy + 48)
  ctx.fillStyle = FAINT
  ctx.font = `500 12px ${MONO}`
  ctx.fillText(surface.ui.model, sx + 16, sy + 86)
  ctx.fillText('/model to change', sx + 16, sy + 108)
  ctx.fillText('directory: ~/code', sx + 16, sy + 130)

  drawBoxAd(ctx, sx + sw / 2 + 6, sy + 12, sw / 2 - 24, 132, adSlot)

  if (cmdOn) printCommand(ctx, surface.command, left, y + 292, 17)
  /* 32px leading keeps the final line clear of the composer at y+510. */
  printLines(ctx, surface, lineCount, left, y + 324, 32, '›', 16, cw)

  ctx.fillStyle = AMBER
  ctx.font = `600 16px ${MONO}`
  ctx.fillText('›', left, y + 510)
  ctx.fillStyle = FAINT
  ctx.font = `400 14px ${MONO}`
  ctx.fillText(surface.ui.input, left + 20, y + 510)
  ctx.fillStyle = HAIR
  ctx.fillRect(left, y + 524, cw, 1.5)

  ctx.fillStyle = FAINT
  ctx.letterSpacing = '0.06em'
  ctx.font = `500 12px ${MONO}`
  ctx.fillText(surface.ui.hint, left, y + 556)
  ctx.letterSpacing = '0px'

  drawDrumFooter(ctx, surface, y, h, left, right)
}

/* --- 03 · Cline — VS Code panel header with Plan/Act chips,
   framed task view, input box, and the model/cost row directly
   under it where the placement sits. ----------------------- */
function drawClineTile(ctx, x, y, w, h, surface, ev) {
  const lineCount = surface.command
    ? Math.max(0, ev - 1)
    : Math.max(0, ev)
  const left = x + 42
  const right = x + w - 42
  const cw = right - left

  panelBase(ctx, x, y, w, h)
  drawRail(ctx, surface, y, left, right)

  const hbY = y + 92
  const hbH = 54
  ctx.fillStyle = 'rgba(255, 255, 255, 0.05)'
  ctx.fillRect(left, hbY, cw, hbH)
  ctx.fillStyle = HAIR
  ctx.fillRect(left, hbY, cw, 1)
  ctx.fillRect(left, hbY + hbH - 1, cw, 1)
  drawLogoMark(ctx, surface.logo, left + 10, hbY + 10, 34)
  ctx.fillStyle = INK
  ctx.font = `700 22px ${SANS}`
  ctx.fillText(surface.name, left + 56, hbY + 34)

  const chipW = 62
  const chipH = 24
  const chipY = hbY + 15
  ;['PLAN', 'ACT'].forEach((label, i) => {
    const cx = right - chipW - (1 - i) * (chipW + 8)
    const active = label === surface.ui.mode
    ctx.font = `600 11px ${MONO}`
    if (active) {
      ctx.fillStyle = AMBER
      ctx.fillRect(cx, chipY, chipW, chipH)
      ctx.fillStyle = '#000000'
    } else {
      ctx.strokeStyle = HAIR
      ctx.lineWidth = 1
      ctx.strokeRect(cx + 0.5, chipY + 0.5, chipW - 1, chipH - 1)
      ctx.fillStyle = FAINT
    }
    ctx.textAlign = 'center'
    ctx.fillText(label, cx + chipW / 2, chipY + 16)
    ctx.textAlign = 'left'
  })

  const sx = x + 24
  const sy = y + 162
  const sw = w - 48
  const sh = 250
  ctx.fillStyle = '#000000'
  ctx.fillRect(sx, sy, sw, sh)
  ctx.strokeStyle = HAIR
  ctx.lineWidth = 1.5
  ctx.strokeRect(sx + 0.75, sy + 0.75, sw - 1.5, sh - 1.5)
  ctx.fillStyle = FAINT
  ctx.letterSpacing = '0.18em'
  ctx.font = `500 10px ${MONO}`
  ctx.fillText('TASK', sx + 16, sy + 24)
  ctx.textAlign = 'right'
  ctx.fillText(surface.ui.ctx, sx + sw - 16, sy + 24)
  ctx.textAlign = 'left'
  ctx.letterSpacing = '0px'
  ctx.fillStyle = HAIR
  ctx.fillRect(sx, sy + 34, sw, 1)
  printLines(ctx, surface, lineCount, sx + 16, sy + 66, 34, '*', 14, sw - 32)

  drawInputBox(ctx, left, y + 428, cw, 46, null, surface.ui.input, null)

  /* The row under the command box — model, cost, context —
     free at its right: the placement's home. */
  ctx.fillStyle = HAIR
  ctx.fillRect(left, y + 490, cw, 1)
  ctx.fillStyle = FAINT
  ctx.font = `500 12px ${MONO}`
  ctx.fillText(surface.ui.status, left, y + 515)
  drawStripAd(ctx, left + 210, y + 490, cw - 210, 40, adSlot)

  ctx.fillStyle = FAINT
  ctx.letterSpacing = '0.06em'
  ctx.font = `500 12px ${MONO}`
  ctx.fillText(surface.ui.hint, left, y + 560)
  ctx.letterSpacing = '0px'

  drawDrumFooter(ctx, surface, y, h, left, right)
}

/* --- 04 · OpenCode — inline header, session view, then the
   status strip above the input (mode · model · time) whose
   empty right holds the placement. ------------------------- */
function drawOpencodeTile(ctx, x, y, w, h, surface, ev) {
  const cmdOn = Boolean(surface.command) && ev >= 1
  const lineCount = surface.command ? Math.max(0, ev - 1) : ev
  const left = x + 42
  const right = x + w - 42
  const cw = right - left

  panelBase(ctx, x, y, w, h)
  drawRail(ctx, surface, y, left, right)

  const box = 52
  const bx = left
  const by = y + 92
  ctx.fillStyle = 'rgba(0, 0, 0, 0.85)'
  ctx.fillRect(bx, by, box, box)
  ctx.strokeStyle = HAIR
  ctx.lineWidth = 1.5
  ctx.strokeRect(bx + 0.75, by + 0.75, box - 1.5, box - 1.5)
  ctx.fillStyle = AMBER
  ctx.fillRect(bx + 7, by + 7, 12, 3)
  drawLogoMark(ctx, surface.logo, bx + 9, by + 14, 34)

  ctx.fillStyle = INK
  ctx.font = `700 30px ${SANS}`
  ctx.fillText(surface.name, left + 66, y + 124)
  ctx.fillStyle = FAINT
  ctx.letterSpacing = '0.14em'
  ctx.font = `500 13px ${MONO}`
  ctx.fillText(surface.provider, left + 66, y + 146)
  ctx.letterSpacing = '0px'

  ctx.fillStyle = AMBER
  ctx.fillRect(left, y + 164, 44, 3)
  ctx.fillStyle = HAIR
  ctx.fillRect(left + 44, y + 164, cw - 44, 1)

  const sx = x + 24
  const sy = y + 186
  const sw = w - 48
  const sh = 248
  ctx.fillStyle = '#000000'
  ctx.fillRect(sx, sy, sw, sh)
  ctx.strokeStyle = HAIR
  ctx.lineWidth = 1.5
  ctx.strokeRect(sx + 0.75, sy + 0.75, sw - 1.5, sh - 1.5)
  ctx.fillStyle = FAINT
  ctx.letterSpacing = '0.18em'
  ctx.font = `500 10px ${MONO}`
  ctx.fillText('SESSION', sx + 16, sy + 24)
  ctx.textAlign = 'right'
  ctx.fillText('EXIT 0', sx + sw - 16, sy + 24)
  ctx.textAlign = 'left'
  ctx.letterSpacing = '0px'
  ctx.fillStyle = HAIR
  ctx.fillRect(sx, sy + 34, sw, 1)
  if (cmdOn) printCommand(ctx, surface.command, sx + 16, sy + 70, 16)
  /* 27px leading keeps all six lines inside the session frame
     (sy..sy+248): at 32px the sixth line fell 18px past its edge. */
  printLines(ctx, surface, lineCount, sx + 16, sy + 100, 27, '❯', 14, sw - 32)

  /* Status strip above the command box — placement at its right. */
  ctx.fillStyle = FAINT
  ctx.font = `500 12px ${MONO}`
  ctx.fillText(surface.ui.strip, left, y + 477)
  drawStripAd(ctx, left + 235, y + 452, cw - 235, 40, adSlot)

  drawInputBox(ctx, left, y + 506, cw, 46, '❯', surface.ui.input, null)

  ctx.fillStyle = FAINT
  ctx.letterSpacing = '0.06em'
  ctx.font = `500 12px ${MONO}`
  ctx.fillText(surface.ui.hint, left, y + 578)
  ctx.letterSpacing = '0px'

  drawDrumFooter(ctx, surface, y, h, left, right)
}

/* --- 05 · Gemini CLI — identity with FREE TIER chip,
   double-framed editor, quota row (rate limits) holding the
   placement, boxed input. --------------------------------- */
function drawGeminiTile(ctx, x, y, w, h, surface, ev) {
  const cmdOn = Boolean(surface.command) && ev >= 1
  const lineCount = surface.command ? Math.max(0, ev - 1) : ev
  const left = x + 42
  const right = x + w - 42
  const cw = right - left

  panelBase(ctx, x, y, w, h)
  drawRail(ctx, surface, y, left, right)

  const box = 52
  const bx = left
  const by = y + 92
  ctx.fillStyle = 'rgba(0, 0, 0, 0.85)'
  ctx.fillRect(bx, by, box, box)
  ctx.strokeStyle = HAIR
  ctx.lineWidth = 1.5
  ctx.strokeRect(bx + 0.75, by + 0.75, box - 1.5, box - 1.5)
  ctx.fillStyle = AMBER
  ctx.fillRect(bx + 7, by + 7, 12, 3)
  drawLogoMark(ctx, surface.logo, bx + 9, by + 14, 34)

  ctx.fillStyle = INK
  ctx.font = `700 30px ${SANS}`
  ctx.fillText(surface.name, left + 66, y + 124)
  ctx.fillStyle = FAINT
  ctx.letterSpacing = '0.14em'
  ctx.font = `500 13px ${MONO}`
  ctx.fillText(surface.provider, left + 66, y + 146)
  ctx.letterSpacing = '0px'

  const tierW = 84
  const tierH = 24
  ctx.strokeStyle = HAIR
  ctx.lineWidth = 1
  ctx.strokeRect(right - tierW + 0.5, y + 104.5, tierW - 1, tierH - 1)
  ctx.fillStyle = FAINT
  ctx.letterSpacing = '0.14em'
  ctx.font = `600 10px ${MONO}`
  ctx.textAlign = 'center'
  ctx.fillText('FREE TIER', right - tierW / 2, y + 120)
  ctx.textAlign = 'left'
  ctx.letterSpacing = '0px'

  ctx.fillStyle = AMBER
  ctx.fillRect(left, y + 164, 44, 3)
  ctx.fillStyle = HAIR
  ctx.fillRect(left + 44, y + 164, cw - 44, 1)

  const sx = x + 24
  const sy = y + 186
  const sw = w - 48
  const sh = 246
  ctx.fillStyle = '#000000'
  ctx.fillRect(sx, sy, sw, sh)
  ctx.strokeStyle = HAIR
  ctx.lineWidth = 1.5
  ctx.strokeRect(sx + 0.75, sy + 0.75, sw - 1.5, sh - 1.5)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)'
  ctx.lineWidth = 1
  ctx.strokeRect(sx + 7, sy + 7, sw - 14, sh - 14)
  ctx.fillStyle = FAINT
  ctx.letterSpacing = '0.16em'
  ctx.font = `500 10px ${MONO}`
  ctx.fillText('GEMINI ▸ GEMINI-3-PRO', sx + 18, sy + 28)
  ctx.textAlign = 'right'
  ctx.fillStyle = AMBER
  ctx.font = `600 10px ${MONO}`
  ctx.fillText('5%', sx + sw - 18, sy + 28)
  ctx.textAlign = 'left'
  ctx.letterSpacing = '0px'
  ctx.fillStyle = HAIR
  ctx.fillRect(sx + 7, sy + 40, sw - 14, 1)
  if (cmdOn) printCommand(ctx, surface.command, sx + 18, sy + 78, 16)
  /* 25px leading keeps all six lines inside the double frame
     (sy..sy+246): at 30px the sixth line fell past its edge. */
  printLines(ctx, surface, lineCount, sx + 18, sy + 106, 25, '❯', 14, sw - 36)

  /* Quota row — rate limits left, placement right. */
  ctx.fillStyle = FAINT
  ctx.font = `500 12px ${MONO}`
  ctx.fillText(surface.ui.quota, left, y + 475)
  drawStripAd(ctx, left + 230, y + 450, cw - 230, 40, adSlot)

  drawInputBox(ctx, left, y + 504, cw, 44, '❯', surface.ui.input, null)

  ctx.fillStyle = FAINT
  ctx.letterSpacing = '0.06em'
  ctx.font = `500 12px ${MONO}`
  ctx.fillText(surface.ui.hint, left, y + 574)
  ctx.letterSpacing = '0px'

  drawDrumFooter(ctx, surface, y, h, left, right)
}

/* --- 06 · Aider — startup banner with the wordmark, plain
   unframed output (no prompt glyph), tokens/cost line whose
   right half is free for the placement, bare prompt. -------- */
function drawAiderTile(ctx, x, y, w, h, surface, ev) {
  const cmdOn = Boolean(surface.command) && ev >= 1
  const lineCount = surface.command ? Math.max(0, ev - 1) : ev
  const left = x + 42
  const right = x + w - 42
  const cw = right - left

  panelBase(ctx, x, y, w, h)
  drawRail(ctx, surface, y, left, right)

  const hbY = y + 92
  const hbH = 42
  ctx.fillStyle = 'rgba(255, 255, 255, 0.05)'
  ctx.fillRect(left, hbY, cw, hbH)
  ctx.fillStyle = HAIR
  ctx.fillRect(left, hbY, cw, 1)
  ctx.fillRect(left, hbY + hbH - 1, cw, 1)
  drawLogoMark(ctx, surface.logo, left + 12, hbY - 12, 64)
  ctx.fillStyle = FAINT
  ctx.font = `500 11px ${MONO}`
  ctx.fillText(surface.ui.banner, left + 92, hbY + 26)
  ctx.textAlign = 'right'
  ctx.fillText('GIT: MAIN', right, hbY + 26)
  ctx.textAlign = 'left'

  if (cmdOn) printCommand(ctx, surface.command, left, y + 170, 17)
  /* 32px leading: the tokens row's hairline sits at y+408, and at
     44px leading the sixth line's glyphs crossed it. */
  printLines(ctx, surface, lineCount, left, y + 210, 32, null, 16, cw)

  /* Tokens/cost line — Aider prints it after each turn; its
     right side is always empty. */
  ctx.fillStyle = HAIR
  ctx.fillRect(left, y + 408, cw, 1)
  ctx.fillStyle = FAINT
  ctx.font = `500 12px ${MONO}`
  ctx.fillText(surface.ui.tokens, left, y + 433)
  drawStripAd(ctx, left + 230, y + 408, cw - 230, 40, adSlot)

  /* Bare prompt — a line, not a box. */
  ctx.fillStyle = AMBER
  ctx.font = `600 17px ${MONO}`
  ctx.fillText('>', left, y + 492)
  ctx.fillStyle = FAINT
  ctx.font = `400 14px ${MONO}`
  ctx.fillText(surface.ui.input, left + 20, y + 492)
  ctx.fillStyle = HAIR
  ctx.fillRect(left, y + 506, cw, 1.5)

  ctx.fillStyle = FAINT
  ctx.letterSpacing = '0.06em'
  ctx.font = `500 12px ${MONO}`
  ctx.fillText(surface.ui.hint, left, y + 540)
  ctx.letterSpacing = '0px'

  drawDrumFooter(ctx, surface, y, h, left, right)
}

/* --- 07 · Copilot CLI — tab row (Session active, red
   underline), framed session view, "Using <model>" line above
   the input with the placement beside it. ------------------ */
function drawCopilotTile(ctx, x, y, w, h, surface, ev) {
  const cmdOn = Boolean(surface.command) && ev >= 1
  const lineCount = surface.command ? Math.max(0, ev - 1) : ev
  const left = x + 42
  const right = x + w - 42
  const cw = right - left

  panelBase(ctx, x, y, w, h)
  drawRail(ctx, surface, y, left, right)

  const box = 44
  const bx = left
  const by = y + 90
  ctx.fillStyle = 'rgba(0, 0, 0, 0.85)'
  ctx.fillRect(bx, by, box, box)
  ctx.strokeStyle = HAIR
  ctx.lineWidth = 1.5
  ctx.strokeRect(bx + 0.75, by + 0.75, box - 1.5, box - 1.5)
  ctx.fillStyle = AMBER
  ctx.fillRect(bx + 7, by + 7, 12, 3)
  drawLogoMark(ctx, surface.logo, bx + 7, by + 10, 30)

  ctx.fillStyle = INK
  ctx.font = `700 28px ${SANS}`
  ctx.fillText(surface.name, left + 58, y + 122)
  ctx.fillStyle = FAINT
  ctx.letterSpacing = '0.14em'
  ctx.font = `500 12px ${MONO}`
  ctx.textAlign = 'right'
  ctx.fillText(surface.provider, right, y + 122)
  ctx.textAlign = 'left'
  ctx.letterSpacing = '0px'

  ctx.fillStyle = AMBER
  ctx.fillRect(left, y + 142, 40, 3)
  ctx.fillStyle = HAIR
  ctx.fillRect(left + 40, y + 142, cw - 40, 1)

  /* Tab row. */
  const tY = y + 158
  const tH = 40
  ctx.fillStyle = HAIR
  ctx.fillRect(left, tY, cw, 1)
  ctx.fillRect(left, tY + tH, cw, 1)
  let tabX = left + 4
  surface.ui.tabs.forEach((tab, i) => {
    const active = i === 0
    ctx.font = `${active ? '600' : '500'} 14px ${SANS}`
    const tabW = ctx.measureText(tab).width
    ctx.fillStyle = active ? INK : FAINT
    ctx.fillText(tab, tabX, tY + 25)
    if (active) {
      ctx.fillStyle = AMBER
      ctx.fillRect(tabX, tY + tH - 2, tabW, 2)
    }
    if (i < surface.ui.tabs.length - 1) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.25)'
      ctx.fillRect(tabX + tabW + 11, tY + 12, 1, 16)
    }
    tabX += tabW + 24
  })
  ctx.textAlign = 'right'
  ctx.fillStyle = FAINT
  ctx.font = `500 11px ${MONO}`
  ctx.fillText(surface.ui.usage, right, tY + 26)
  ctx.textAlign = 'left'

  const sx = x + 24
  const sy = y + 214
  const sw = w - 48
  const sh = 228
  ctx.fillStyle = '#000000'
  ctx.fillRect(sx, sy, sw, sh)
  ctx.strokeStyle = HAIR
  ctx.lineWidth = 1.5
  ctx.strokeRect(sx + 0.75, sy + 0.75, sw - 1.5, sh - 1.5)
  ctx.fillStyle = FAINT
  ctx.letterSpacing = '0.18em'
  ctx.font = `500 10px ${MONO}`
  ctx.fillText('SESSION', sx + 16, sy + 24)
  ctx.textAlign = 'right'
  ctx.fillText('SONNET 4.5', sx + sw - 16, sy + 24)
  ctx.textAlign = 'left'
  ctx.letterSpacing = '0px'
  ctx.fillStyle = HAIR
  ctx.fillRect(sx, sy + 34, sw, 1)
  if (cmdOn) printCommand(ctx, surface.command, sx + 16, sy + 68, 15)
  /* 24px leading keeps all six lines inside the session frame
     (sy..sy+228): at 28px the sixth line fell past its edge. */
  printLines(ctx, surface, lineCount, sx + 16, sy + 98, 24, '*', 14, sw - 32)

  /* "Using <model>" above the input — placement beside it. */
  ctx.fillStyle = FAINT
  ctx.font = `500 12px ${MONO}`
  ctx.fillText(surface.ui.model, left, y + 481)
  drawStripAd(ctx, left + 180, y + 456, cw - 180, 40, adSlot)

  drawInputBox(ctx, left, y + 510, cw, 44, '*', surface.ui.input, null)

  ctx.fillStyle = FAINT
  ctx.letterSpacing = '0.06em'
  ctx.font = `500 12px ${MONO}`
  ctx.fillText(surface.ui.hint, left, y + 578)
  ctx.letterSpacing = '0px'

  drawDrumFooter(ctx, surface, y, h, left, right)
}

/* --- 08 · Local / self-hosted — a bare REPL: minimal identity,
   plain output, no idle chrome strip at all. The placement is
   reserved below and opens only once stdout finishes. ------ */
function drawShellTile(ctx, x, y, w, h, surface, ev, total) {
  const cmdOn = Boolean(surface.command) && ev >= 1
  const lineCount = surface.command ? Math.max(0, ev - 1) : ev
  const left = x + 42
  const right = x + w - 42
  const cw = right - left

  panelBase(ctx, x, y, w, h)
  drawRail(ctx, surface, y, left, right)

  ctx.fillStyle = INK
  ctx.font = `700 26px ${SANS}`
  ctx.fillText(surface.name, left, y + 118)
  ctx.fillStyle = FAINT
  ctx.letterSpacing = '0.14em'
  ctx.font = `500 12px ${MONO}`
  ctx.fillText(surface.provider, left, y + 142)
  ctx.letterSpacing = '0px'
  drawLogoMark(ctx, surface.logo, right - 34, y + 96, 34)

  ctx.fillStyle = AMBER
  ctx.fillRect(left, y + 160, 40, 3)
  ctx.fillStyle = HAIR
  ctx.fillRect(left + 40, y + 160, cw - 40, 1)

  if (cmdOn) printCommand(ctx, surface.command, left, y + 202, 17)
  /* 36px leading: the deferred band below opens (and fills) exactly
     when stdout completes, so its frame must clear the last line. */
  printLines(ctx, surface, lineCount, left, y + 238, 36, '>>>', 16, cw)

  drawDeferredBand(ctx, left, y + 446, cw, 100, adSlot, ev >= total)

  ctx.fillStyle = FAINT
  ctx.letterSpacing = '0.1em'
  const hint = fitText(ctx, surface.ui.hint, cw, '500', 11, 8, MONO)
  ctx.fillText(hint, left, y + 568)
  ctx.letterSpacing = '0px'

  drawDrumFooter(ctx, surface, y, h, left, right)
}

/* Dispatch — each surface's chrome picks its painter. The event
   count (from tileCounts) drives line printing; the deferred
   band compares it against the surface's total. */
function drawTile(ctx, x, y, w, h, surface, events) {
  const total = tileEvents(surface)
  const ev = events === undefined ? total : events
  switch (surface.chrome) {
    case 'claude':
      return drawClaudeTile(ctx, x, y, w, h, surface, ev)
    case 'codex':
      return drawCodexTile(ctx, x, y, w, h, surface, ev)
    case 'cline':
      return drawClineTile(ctx, x, y, w, h, surface, ev)
    case 'opencode':
      return drawOpencodeTile(ctx, x, y, w, h, surface, ev)
    case 'gemini':
      return drawGeminiTile(ctx, x, y, w, h, surface, ev)
    case 'aider':
      return drawAiderTile(ctx, x, y, w, h, surface, ev)
    case 'copilot':
      return drawCopilotTile(ctx, x, y, w, h, surface, ev)
    case 'shell':
      return drawShellTile(ctx, x, y, w, h, surface, ev, total)
    default:
      return undefined
  }
}

/* Removal marker kept so nobody re-adds a standalone sponsored tile
   by copying from an older revision. */
/* -------------------------------------------------------------
   Scroll-driven terminal print.
   -------------------------------------------------------------
   Each CLI's output prints line by line as its surface swings
   through the readable zone: the reveal starts 45° before dead
   front and completes 30° past it, so the last line always lands
   BEFORE the next surface takes the front, then holds. One event = one row on the screen — the
   '$ command' row first, then each output line, finishing with the
   ✓ line. The count is a pure function of the drum's angle: output
   stops printing when scroll stops and un-prints when scroll
   reverses. No timers anywhere. */
function tileEvents(surface) {
  return surface.command ? 1 + surface.lines.length : surface.lines.length
}

function tileCounts(f) {
  return SURFACES.map((surface, i) => {
    const a = (i - f) * 45 /* degrees from dead front, + = approaching */
    const u = clamp01((45 - a) / 75)
    if (u <= 0) return 0
    const total = tileEvents(surface)
    return Math.min(total, Math.ceil(u * total))
  })
}

function buildAtlas(gl) {
  /* Respect the GPU's texture ceiling: lay out in virtual tile
     coordinates and scale the whole canvas down when 8 × 512 would
     exceed it. */
  const maxTex =
    (gl && gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 4096
  const tw = Math.min(TILE_W, Math.floor(maxTex / SURFACES.length))
  const th = Math.round((tw * TILE_H) / TILE_W)
  const canvas = document.createElement('canvas')
  canvas.width = tw * SURFACES.length
  canvas.height = th
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = VOID
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.setTransform(tw / TILE_W, 0, 0, th / TILE_H, 0, 0)
  const counts = tileCounts(0.5) /* the opening frame's print state */
  SURFACES.forEach((surface, i) => {
    drawTile(ctx, i * TILE_W, 0, TILE_W, TILE_H, surface, counts[i])
  })
  return canvas
}

/* -------------------------------------------------------------
    Shaders.
    -------------------------------------------------------------
    The vertex stage is the standard transform with the view-space
    normal and view direction handed forward; the fragment stage is
    where the drum gets its depth. A steep facing term makes the
    front surface the hero — side panels fall away in brightness and
    contrast (roughly half opacity), the rear of the drum nearly
    disappears — and the end caps get their own near-black treatment
    with a restrained red hairline. Red stays an edge whisper here,
    never a fill — the environment is black. */

const SURFACE_VERTEX = `
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat3 normalMatrix;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vView;
varying float vCap;

void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vUv = uv;
  vNormal = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  vCap = smoothstep(0.85, 0.985, abs(normal.y));
  gl_Position = projectionMatrix * mv;
}
`

const SURFACE_FRAGMENT = `
precision highp float;

uniform sampler2D tMap;
uniform float uReveal;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vView;
varying float vCap;

void main() {
  vec3 tex = texture2D(tMap, vUv).rgb;

  float facing = clamp(dot(normalize(vNormal), normalize(vView)), 0.0, 1.0);
  float wall = 1.0 - vCap;

  /* Front panel is the hero: falloff so side panels sit around
     half brightness and the back of the drum nearly disappears. */
  float shade = pow(facing, 1.75);
  vec3 col = tex * (0.12 + 1.05 * shade);
  col *= 1.0 + 0.13 * smoothstep(0.70, 1.0, facing) * wall;

  /* Subtle edge lighting: a neutral rim so the silhouette reads as
     a machined object against the page — definition, never glow. */
  col += vec3(1.0, 1.0, 1.0) * pow(1.0 - facing, 3.0) * 0.05 * wall;

  /* Vertical dissolve, so the drum has no hard top or bottom edge. */
  float edge = smoothstep(0.0, 0.14, vUv.y) * smoothstep(0.0, 0.14, 1.0 - vUv.y);
  col *= mix(1.0, 0.30 + 0.70 * edge, wall);

  /* End caps: a near-black disc with a faint red hairline. */
  vec3 capCol = vec3(0.0)
    + vec3(1.0, 0.122, 0.176) * smoothstep(0.42, 0.495, length(vUv - 0.5)) * 0.12;
  capCol *= 0.55 + 0.45 * facing;
  col = mix(col, capCol, vCap);

  /* A whisper of red at the grazing silhouette — hint, never glow.
     (No scanlines: the old sin() banding is deliberately gone — the
     surface is clean black, not a CRT.) */
  col += vec3(1.0, 0.122, 0.176) * pow(1.0 - facing, 3.5) * 0.025 * wall;

  float alpha = uReveal * mix(1.0, edge, wall * 0.9);
  gl_FragColor = vec4(col, alpha);
}
`

/* -------------------------------------------------------------
    The component.
    ------------------------------------------------------------- */
function OrbitRing() {
  const stageRef = useRef(null)
  const hostRef = useRef(null)
  const canvasRef = useRef(null)
  const progressRef = useRef(null)
  const readyRef = useRef(false)
  const [failed, setFailed] = useState(false)
  const [ready, setReady] = useState(false)
  const reduced = usePrefersReducedMotion()

  useEffect(() => {
    const stage = stageRef.current
    const host = hostRef.current
    const canvas = canvasRef.current
    if (!stage || !host || !canvas) return undefined

    /* Failure is reported through a scheduled callback: the effect body
       itself must not flip state synchronously. */
    const fail = () => queueMicrotask(() => setFailed(true))

    let renderer
    try {
      renderer = new Renderer({
        canvas,
        alpha: true,
        antialias: true,
        premultipliedAlpha: false,
        dpr: Math.min(window.devicePixelRatio || 1, 2),
      })
    } catch (error) {
      /* No WebGL at all: fall back to a flat instrument strip rather
         than an empty frame. The journey rail above already carries the
         semantics, so nothing is lost to a reader. */
      console.error('[OrbitRing] webgl unavailable', error)
      fail()
      return undefined
    }

    const gl = renderer.gl
    gl.clearColor(0, 0, 0, 0)

    const scene = new Transform()
    const camera = new Camera(gl, { fov: 42, near: 0.1, far: 60 })
    /* One rig carries the cinematic scale so the drum, its ticks and
       its station rings grow together. */
    const rig = new Transform()
    rig.setParent(scene)
    const drum = new Transform()
    drum.setParent(rig)

    const texture = new Texture(gl, {
      image: buildAtlas(gl),
      generateMipmaps: true,
      minFilter: gl.LINEAR_MIPMAP_LINEAR,
      anisotropy: 4,
    })

    /* Per-tile repaint machinery for the scroll-driven terminal
       print: only tiles whose event count changed are repainted into
       a scratch canvas and pushed with texSubImage2D (a few hundred
       KB at event boundaries — never a full atlas re-upload). The
       sync runs AFTER renderer.render so the texture's first upload
       has definitely happened; texSubImage2D on a never-uploaded
       texture would be an INVALID_OPERATION. */
    const atlasCanvas = texture.image
    const atlasTw = atlasCanvas.width / SURFACES.length
    const atlasTh = atlasCanvas.height
    const scratch = document.createElement('canvas')
    scratch.width = atlasTw
    scratch.height = atlasTh
    const scratchCtx = scratch.getContext('2d')
    let lastCounts = tileCounts(0.5)

    const syncCounts = (counts) => {
      for (let i = 0; i < counts.length; i += 1) {
        if (counts[i] === lastCounts[i]) continue
        lastCounts[i] = counts[i]
        scratchCtx.setTransform(1, 0, 0, 1, 0, 0)
        scratchCtx.clearRect(0, 0, atlasTw, atlasTh)
        scratchCtx.setTransform(atlasTw / TILE_W, 0, 0, atlasTh / TILE_H, 0, 0)
        drawTile(scratchCtx, 0, 0, TILE_W, TILE_H, SURFACES[i], counts[i])
        const prev = gl.getParameter(gl.TEXTURE_BINDING_2D)
        gl.bindTexture(gl.TEXTURE_2D, texture.texture)
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          Math.round(i * atlasTw),
          0,
          Math.round(atlasTw),
          Math.round(atlasTh),
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          scratch,
        )
        gl.generateMipmap(gl.TEXTURE_2D)
        gl.bindTexture(gl.TEXTURE_2D, prev)
      }
    }

    const surfaceProgram = new Program(gl, {
      vertex: SURFACE_VERTEX,
      fragment: SURFACE_FRAGMENT,
      uniforms: {
        tMap: { value: texture },
        uReveal: { value: 0 },
      },
      transparent: true,
      cullFace: gl.BACK,
    })

    const drumGeometry = new Cylinder(gl, {
      radiusTop: RADIUS,
      radiusBottom: RADIUS,
      height: HEIGHT,
      radialSegments: 64,
      heightSegments: 1,
      openEnded: false,
    })

    const drumMesh = new Mesh(gl, { geometry: drumGeometry, program: surfaceProgram })
    drumMesh.setParent(drum)

    /* Station rings removed: circles around the drum read as
       horizontal lines across the carousel. The cylinder is the
       only geometry — panels, their vertical grid and lighting. */

    /* --------------------------------------------------------
       Frame production.
       --------------------------------------------------------
       Normalized progress comes from ONE ScrollTrigger on the stage
       (start: stage top hits viewport top, end: stage bottom hits
       viewport bottom, scrub) — the same Lenis-driven system the film
       runs. Native box measurement is only the fallback if that
       trigger could not be created. Rotation is produced by exactly
       one pipeline: target → damping → `angle` → `drum.rotation.y`.
       No other writer, no direct scroll listener, no second smoother. */
    let raf = 0
    let inView = false
    let last = 0
    let angle = PHASE /* the ONE authoritative rendered angle */
    let reveal = reduced ? 1 : 0
    let width = 0
    let height = 0
    let viewScale = 1
    let panScale = 1
    let observer = null
    let ro = null
    let st = null
    let alive = true
    let fontsRepaint = false

    /* Scroll instrument state: written only when a value changes. */
    const progressEl = progressRef.current
    const fillCache = new Array(SURFACES.length).fill(-1)
    const actCache = new Array(SURFACES.length).fill(false)

    const nativeProgress = () => {
      const rect = stage.getBoundingClientRect()
      const vh = window.innerHeight || 1
      return clamp01(-rect.top / Math.max(1, rect.height - vh))
    }

    const progress = () => (st ? st.progress : nativeProgress())

    if (!reduced) {
      try {
        st = ScrollTrigger.create({
          trigger: stage,
          start: 'top top',
          end: 'bottom bottom',
          scrub: true,
        })
      } catch (error) {
        console.error('[OrbitRing] scrolltrigger unavailable', error)
        st = null
      }
    }

    const draw = (p, dt) => {
      reveal += (1 - reveal) * Math.min(1, dt * 2.6)
      if (reveal > 0.995) reveal = 1

      /* ONE authoritative angle: scroll progress mapped to 0.70 of a
         revolution (negative, so the surfaces advance in reading
         order — 01 → 02 → … → 08). No time-based idle term — the
         rendered state is a pure function of scroll position, so the
         same scroll always resolves to the same visual. Frame-rate-
         correct damping follows the target and snaps once the gap is
         negligible, so a settled frame is exactly deterministic.
         dt <= 0 (the reduced-motion static frame) snaps instead. */
      const target = PHASE - p * TURNS * Math.PI * 2
      angle = dt > 0 && !reduced
        ? angle + (target - angle) * (1 - Math.exp(-dt * DAMP))
        : target
      if (Math.abs(target - angle) < 1e-4) angle = target

      const cam = sampleCamera(p)
      /* Portrait viewports dolly out along the same ray and damp the
         lateral sweep so the drum stays readable in a narrow frame —
         a simplified, nearly frontal cylinder rather than a flattened
         desktop perspective. */
      camera.position.set(
        cam[0] * panScale * viewScale,
        cam[1] * panScale * viewScale,
        cam[2] * viewScale,
      )
      camera.lookAt([cam[3], cam[4], cam[5]])

      const s = scaleAt(p)
      rig.scale.set(s, s, s)
      drum.rotation.y = angle
      surfaceProgram.uniforms.uReveal.value = reveal

      renderer.render({ scene, camera })

      /* The terminal print and the scroll instrument follow the
         DAMPED angle — exactly the rotation on screen, so lines and
         drum move as one mechanism. Pure function of position: stop
         scrolling → printing stops; scroll back → lines un-print. */
      const f = 0.5 + (PHASE - angle) * (SURFACES.length / (Math.PI * 2))
      syncCounts(tileCounts(f))

      if (progressEl) {
        const rows = progressEl.children
        for (let i = 0; i < rows.length; i += 1) {
          const fill = clamp01(f - i)
          const bar = rows[i].lastElementChild.firstElementChild
          if (fillCache[i] !== fill) {
            fillCache[i] = fill
            bar.style.transform = `scaleX(${fill})`
          }
          const active = Math.abs(f - 0.5 - i) < 0.5
          if (actCache[i] !== active) {
            actCache[i] = active
            rows[i].classList.toggle('is-active', active)
          }
        }
      }

      if (!readyRef.current) {
        readyRef.current = true
        setReady(true)
      }
    }

    const stop = () => {
      if (!raf) return
      cancelAnimationFrame(raf)
      raf = 0
    }

    const start = () => {
      if (reduced || raf) return
      last = 0
      raf = requestAnimationFrame(tick)
    }

    function tick(now) {
      raf = requestAnimationFrame(tick)
      if (!inView) return
      const t = now * 0.001
      const dt = last ? Math.min(0.06, t - last) : 1 / 60
      last = t
      try {
        draw(progress(), dt)
      } catch (error) {
        console.error('[OrbitRing] frame failed', error)
        stop()
        fail()
      }
    }

    const resize = () => {
      const rect = host.getBoundingClientRect()
      const w = Math.max(1, Math.round(rect.width))
      const h = Math.max(1, Math.round(rect.height))
      const aspect = w / h
      viewScale = aspect < 0.55 ? 1.8 : aspect < 0.8 ? 1.45 : aspect < 1.15 ? 1.15 : 1
      panScale = aspect < 0.8 ? 0.34 : aspect < 1.15 ? 0.6 : 1
      if (w === width && h === height) return
      width = w
      height = h
      renderer.setSize(w, h)
      camera.perspective({ fov: 42, aspect, near: 0.1, far: 60 })
      /* Reduced motion never runs the loop, so the one hand-placed
         frame is redrawn here whenever the box changes. */
      if (reduced) draw(STATIC_P, 0)
    }

    /* Canvas text never triggers a font load, and the atlas is baked
       once at mount — so if the self-hosted woff2 files land after the
       first paint, the drum would keep rendering fallback glyphs
       forever. When the font set settles, repaint every tile IN PLACE
       with its current print count (not the full state: output must
       stay a pure function of scroll position) and re-upload the whole
       atlas. Per-tile syncs continue to work unchanged on top of it. */
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready
        .then(() => {
          if (!alive || fontsRepaint) return
          fontsRepaint = true
          const atlasCtx = atlasCanvas.getContext('2d')
          atlasCtx.setTransform(1, 0, 0, 1, 0, 0)
          atlasCtx.fillStyle = VOID
          atlasCtx.fillRect(0, 0, atlasCanvas.width, atlasCanvas.height)
          atlasCtx.setTransform(atlasTw / TILE_W, 0, 0, atlasTh / TILE_H, 0, 0)
          SURFACES.forEach((surface, i) => {
            drawTile(atlasCtx, i * TILE_W, 0, TILE_W, TILE_H, surface, lastCounts[i])
          })
          const prev = gl.getParameter(gl.TEXTURE_BINDING_2D)
          gl.bindTexture(gl.TEXTURE_2D, texture.texture)
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
          gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            atlasCanvas,
          )
          gl.generateMipmap(gl.TEXTURE_2D)
          gl.bindTexture(gl.TEXTURE_2D, prev)
          if (reduced) draw(STATIC_P, 0)
        })
        .catch((error) =>
          console.error('[OrbitRing] font-settle repaint failed', error),
        )
    }

    const teardown = () => {
      alive = false
      stop()
      if (st) st.kill()
      if (observer) observer.disconnect()
      if (ro) ro.disconnect()
      window.removeEventListener('resize', resize)
    }

    try {
      if (typeof IntersectionObserver !== 'undefined') {
        observer = new IntersectionObserver(
          (entries) => {
            const entry = entries[entries.length - 1]
            inView = entry.isIntersecting
            if (inView) start()
            else stop()
          },
          /* A little lead in both directions: the reveal ramp and the
             opening camera key begin before the frame is on screen. */
          { rootMargin: '140px 0px 140px 0px' },
        )
        observer.observe(host)
      } else {
        inView = true
        start()
      }

      if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(() => resize())
        ro.observe(host)
      }
      window.addEventListener('resize', resize, { passive: true })

      resize()
    } catch (error) {
      console.error('[OrbitRing] init failed', error)
      teardown()
      fail()
      return undefined
    }

    return teardown
  }, [reduced])

  const state = failed ? 'failed' : ready ? 'ready' : 'boot'

  return (
    <section className="orbit" data-state={state} ref={stageRef}>
      <div className="orbit__sticky">
        <div className="orbit__frame" ref={hostRef}>
          {failed ? (
            /* Only ever rendered when WebGL is unavailable: the same eight
               surfaces as a flat strip, so the region is never blank. */
            <div className="orbit__fallback">
              {SURFACES.map((surface, i) => (
                <span key={`${surface.index}-${i}`}>
                  <i>{surface.index}</i>
                  {surface.name}
                </span>
              ))}
            </div>
          ) : (
            <canvas className="orbit__canvas" ref={canvasRef} aria-hidden="true" />
          )}
        </div>
        {/* Scroll-position instrument: one row per drum surface,
            white track, white fill, red only on the surface
            currently at dead front. Orthogonal by design — this must
            never become radial spokes. Filled imperatively from the
            render loop; no React re-renders per frame. */}
        <div className="orbit__progress" ref={progressRef} aria-hidden="true">
          {SURFACES.map((surface, i) => (
            <div className="orbit__progress-row" key={`${surface.name}-${i}`}>
              <span>{surface.index}</span>
              <i>
                <b />
              </i>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export default OrbitRing
