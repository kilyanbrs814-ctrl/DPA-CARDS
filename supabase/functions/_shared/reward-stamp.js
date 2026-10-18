// The last loyalty stamp is configurable without changing the legacy star.
// All image identifiers are constrained to the same server-side whitelist.
import { loadRewardStar } from './reward-star.js';
import { libraryStampId, loadLibraryStamp } from './stamp-library.js';
export async function loadRewardStamp(value) {
  const id=libraryStampId(value);
  if(id) {
    const png=await loadLibraryStamp(id);
    if(png)return png;
  }
  return loadRewardStar();
}
