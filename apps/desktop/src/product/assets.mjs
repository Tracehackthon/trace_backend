// Approved originals stay in artifacts. These runtime copies have fixed roles;
// changing a visual requires an explicit new approval, not a fresh generation.
const asset = name => new URL(`../../public/${name}`, import.meta.url).href;
const shared = Object.freeze({birdPerched:asset('home/bird-perched.png'),birdTakeoff:asset('home/bird-takeoff.png'),serifFont:asset('product/fonts/TraceSerif.woff2'),sansFont:asset('product/fonts/TraceSans.ttf')});
export const ASSETS = Object.freeze({
  home:{...shared,background:asset('home/environment.png')},
  matters:{...shared,background:asset('matters/environment.png')},
  chain:{...shared,background:asset('product/chain-environment.png'),overviewBackground:asset('product/chain-overview-environment.png')},
  compare:{...shared,background:asset('product/compare-environment.png')},
  worksite:{...shared,background:asset('product/worksite-environment.png')},
});
