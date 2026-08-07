/**
 * Font Awesome 6 Free (solid), subset to the twenty glyphs this game
 * actually uses — 3.2KB against the full face's 158KB — embedded as a
 * data: URI like Silkscreen (fonts: SIL OFL 1.1, icons: CC BY 4.0).
 * The solid style only renders at WEIGHT 900; anything lighter silently
 * falls back, which reads as a blank box. Family name here is 'FAS'.
 *
 * Where these belong: the DOM (menu rows, buttons) at native sizes, and
 * the HUD canvas SPARINGLY at >=8px — FA is smooth vector work, and at
 * tiny sizes it antialiases soft against the hard-pixel face. That
 * trade is exactly what this first pass exists to judge.
 */
const FA = 'data:font/woff2;base64,d09GMgABAAAAAAxUAAoAAAAAF2gAAAwMAwcFAAAAAAAAAAAAAAAAAAAAAAAAAAAABmAAgUTKpWQBNgIkA1TLLAQgBYMYByAbuRYRFatNh9BxmMLtyK0hGawkiWEcSDj/5J31doQksz+xmf17gwyD6ACJk9Bddusk3dA6Nc+Z74k5Z77tfZN8Mc8385xZsrnU7OUo6fbrz8pYql5W56QloLgAwBJYREYA+P+/ltrZlGYKpCIL7CJ8y9LM3v8W/h+gDQHPhictq7LsiU2PR94yCpNT58u2LdGgRVtweZ71m46h7n7woFIIds8AIhGEO0ECwH14DgDsJNc8BWW4s5kAE+CzwoZbw+bjjtoPxUh6ZojfnnwMgMiwNw8QDhk24wcAIAIFCMRw7hqSq0T44M8/AxGIoIykkTcqjWZGW0eXjx4avW/09ccaj33qsc88fv0TX32q/bviD59e9z+cTAAKb/dl/0+sF63/W/+2fmN9yXqFdaN1srXV/K95lHmk8XJ9j/o/9U+qw36hHA0InxQR+OQzZCkOIQHA6aRCaUrTlieH4b5lGGQZQ2pb9IjYmAeb85TfwLin5gueLJvnlYllu8Vtjm0LpfMMiXoLOb7fQXTuDATXM8897Oka27aNabp3+FzTc4XgTiCgT4b4JA5hHi4GwIDSNPA5DdOAyrQLhUnCjBe3G3YCCbRTiWyWrpnRFhbNOMoQ0rZUTiFoShBGtpxWBI2Py9pPiyNRXUrIUlWkTFJ11VzNS7po8SDwTVEv8dWmajCJ0YL7Zoasih1HyyZBUFpG/NawbKozumHoM6rpOoptaaJrs7WmIIqCuZbZrqhZtuI4lpoY26XqmuVr1AHuuzCZmVF+C3N7+8kfSI4DWA0HADDuYlKVqZDKfhAGYTdVzsZf5vtpVxdlllFRXx0Q2aVcl91UwZ/z+VitHIS9eDvftuk1AlpW6ZuMmSZj3yxZFgrXUNv29ybqOUVEXxzoGh9/lLGSep4jcgnhatU+rumpRcM8fxP1OAAiwOQnpMD3QgVS2AKnGYIcpnmhTA0AizYnakbBeEBzV/g8ljNCmpQYjv0IHLxHqgoh1tsDSJDWaoihdepZujVbAp/lpd6G1hC9W66t211Cul+Ou77lolUQpozHlS5zEV3Pumdb1WVSd6vb7rE8fOPMmounp7Xn85bt2q2Vu/PzwP17GX1vdTpZryns3661Fu94WczCet6KFQeFy8wwNAte4TDj44IzxbhOqMill19nKLCwH2OIBQ6hBssAwumEOdBYYOCu8BlfUBYz7FAALWD/Wb+P7MUCabWIHLOIxfwk8b5Aer2P+bxlIUbNlRai1Q4DzDN6rri9NZvqepmoidjWFx8sUr6yGWGVdwrCNoAweW7yKXIPfh2akMERAN40lUOEBnQNT/piHcsLe9nB4fQAZahCyF8dyjGcl/yRvlTvQzS0dJv0ic95/iHnmijqYRgv2u2uZbnwX5+cWXM9nyk4iaGwUrnJiEBPfEW5ltwST213JEm7oCyKr/QW3/Ezuu1Z45W7z3tkM2qWdb0Wxz6BENF2qscfmkIyM7shHDca7abnEaIyzdZ3jNSMGQ11z/K0zpOQxloQJi9M/kAkHIALTegYq+RJVLTsTLFhnZOpn46Fq+rCqoUGD03R52HQ7VjUPIT6L1RVD8f9UKftfqkHASE/00RO1QO98QLnHno653hZu4IElwXkov+hJBGPDWTy0mSId+AQlsMGAG9VxhzFGwhzcTdm8GOgWh63OIFNgKRAdqYOu7HgAvqRQDg/Ul1bE6DEVHs8tFUmYbBGbxTtIke0n7G+3OZlzVywTMMwLSFvvkwuGA/m8415U1YIiFWdXDzV08yt86o03aoJQEg3MxFoPIU8pJjGO6W8cVeydNh/Cvn5bet1QRYUKu+X6BoLJVaHRPHDnAeoH+foefUa/3i5Ph4p1y5I9bGewFcIyvsktNZQab9MFUHe3eew8jFeq3se8o+x48nycEGAWQWHPaowB1sAvCGledRJz7z1s2MZqyNECXRKnyekTlIv1+MwEJzUbt6hhoZMX2+/V3mCMXOoKaI6DhZ5rustIlwcFM8aDys6T1QuBecBdEA+wGYUNZEgOHWGuPWA1XA93AULttjruL6PfcwIQRI+skAaJn4DiPNm9CNIOmQ0QwEYjFBCApiS6gi+sHO1a0AgHGOLDAgVc1XLpSDLmMvJiZ/NuTk59lM1pROTse3rDENI645hIvL27jHlLqI4UY4fgqtKohu+V1qsaa1myH1dm+WuYXCvnCNUSqZSq+XNlu8HOGTMtB2z4rqiwhR3/A+fGZV2zbLVVdbfgma7c+AzpmluMTfrBHMmYI6yvFUXcKeg76Ay5ijqGyVVJrtQkvbau19OmLSLyOTAK3bs2MG2E0kCEENvCO5iwE44ES4G8GhGWxoRqNPsjGIz8zlYRDA9H4N9Eul7fwYVbrljV4h9sRz7ngreBKcrSvDxQDktRmyUS82PN0tlNXY1jbGBZo6HtCoe7R6PKXjH0lzc+9mCI/L+2dc+dFzXqZ9dtW2+sLKMuZKcZYHbNj2pejJUZQOanb5ZJfBb0V3yyWSWS8eWryz+Py3tmA7sH78c95CJX95Nid/aWybBO5tq8S6fSHtbcSXdXe4pv1xSFAk//Ravo8wnu7fKibIRdbKW+Ew+0RbT3eVvkWVw6pT/SHJ8IygQQgIgJWHipGHqZA78jtEBM5o56SxTpbU9yxdDXDK61WAqonlofOkhRHi7liH1/G3Z+FbEO8Y35+/oSJQa4w9ZdC3etBaq6kipy3iQYND4YjgPzWJLP9FwSXvoKVBEjnY/1SQ5bsRuFtTlRnOWfdU01RJgtO36M7u8XFYIhePL0vPJznxLxytBYqUCxlVIgR+BMrRhCSTX7YAz4MJpf1nMnGwdnxvBBWywgqq9DH9NgmEBv+DNLHEh6d78jaaehAsGzuctv8IN8l5QrwcP+P4DpLkXfa3zcHuMtJiHxBg2dr1CkeXgqkF+Fr5BcpQ0P59rltqZ/oP0wn7W+JOiWRvxGqqCq9rXFUgKZ+IExeneVoi/SyGRsTkA83K2euJBCMT0pcvLF2GPach04ZpCtFAIFv0ZOqnSUIgRUcfSBnXKVLmMp6f0DTMyDNve7yHnzSbnqGuO4gjZ4z/MxQsKC3+tYnx1WC5PReN6jNfIthPmkW0bxn6vapSiV0mCxFkjR9NwAUdyCnsekMd+ybFIIUO2wClwAQCGHDwpKNIJw/YHG7KN2ICjFgPWLXIpBBg0+ycYDD+BzDfYTKVhw5JFM+5ibawtXnJNx5DRsnCcRqPdDqr7mGCx2nZwQzn+jJ4TiOt113FcMiVmgv2VNU1WUKh4dgV2wf3wSvgF/BUA/Tm/mxKjQaImnxFEx5sVp0x0n1BWlqxMRlcmdWM5MQMTlKGHFoR3UxYkaE1ot2CLg2EbgFViMSV40kRyUAnLsIQyRsXK/h379+/v07UmaLVms5A1zmmWgxKvOEDD5PORN37Ktm0uapptaYYmCx4hniBntmXLrshz96o6iqN2VKqWrltV4lxgJHJJR3Lcde5jWCqFuHOKHHL4hB+RAZABEUGJPP8ugD43DcTy39oZsXeBD7Z71l/rEUGBCxXgd8zmBuyCM1cLKMhE3ZBW1MDY1XDRXyn0NwAVSlTTP2KiK2v4e0XLAD5ZStRC4UAd+ps3JyF/3BIb9W7ntmPfcR6ya4gkjyWK9fM0Qsx49vjLS2JS09TfErkiFQsWTcWiLg5SGqaT+839c92mjhw2RNmfOw/x+vQBU2ntPN1cVyLr1h0/xw4h2s1hkPaFvam0+ccDQACBSvAk+8Gtp1nrn1I0Ap+qP99+wcvIvpMnJx8jD+C3IVxSiQIE+APQIcWUnqKn/3N5HwsAkgMnADrdFkgBgMWWk+cITF5A6aUKABz+EItq0aIyGMjCjpH0+f7r4Ke4Hr9FPHKY/FZYLtwj/Ek8JNWky6QPSk/IL6NV+m7lbyS7AgHAp3eA3+ljAXb0fhROFABFBrAK2I0InVUbCajnbBRg42VTxWIbJTjr/b1lWIoubL308Jtcf8X55553VTRz5my049JLEltvvvbsKzu/mI4pS3WtV5FfkeLMjyrNuOj8s5iJrs6XFXOXZyG3c+ziV1wT5wsKG882PlesXZmuSXiXSh0MY6yNBa8RdPxaiBoxZ6uOdLJ63Vux7PQF+AAA';
export const ICON_FONT = 'FAS';
/** The subset's whole vocabulary — add a glyph here AND to the pyftsubset
 *  unicodes list in the build note, or it draws as a blank. */
export const ICON = {
  pin: '',          // location-dot — a place
  here: '',         // location-crosshairs — CURRENT
  tack: '',         // thumbtack — a saved spot
  wrench: '',       // repair / service
  fuel: '',         // gas-pump
  flag: '',         // flag-checkered — missions / surveys
  star: '',
  gear: '',         // settings
  map: '',          // drives
  road: '',
  car: '',
  dice: '',         // elsewhere — a random start
  truck: '',        // truck-monster — the rig
  save: '',         // floppy-disk
  sound: '',        // volume-high
  hide: '',         // eye-slash
  gps: '',          // satellite-dish
  warn: '',         // triangle-exclamation
  tree: '',         // park
  drop: '',         // water
} as const;
/** Register the face for DOM and canvas alike. Idempotent. */
let loaded = false;
export function loadIcons(): void {
  if (loaded) return;
  loaded = true;
  const st = document.createElement('style');
  st.textContent = `@font-face { font-family: '${ICON_FONT}'; font-style: normal; font-weight: 900; src: url(${FA}) format('woff2'); }`;
  document.head.appendChild(st);
  try {
    const f = new FontFace(ICON_FONT, `url(${FA})`, { weight: '900' });
    document.fonts.add(f);
    void f.load();
  } catch { /* the @font-face above still covers the DOM */ }
}
