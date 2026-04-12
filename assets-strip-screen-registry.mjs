/**
 * Fills the workbench resources strip with one chip per screen JSON from screens-registry.
 */
import reg from './screens-registry.embedded.mjs';

const host = document.getElementById('sls-screen-registry-assets');
if (host) {
    for (const s of reg.screens) {
        const chip = document.createElement('span');
        chip.className = 'sls-asset-chip';
        chip.textContent = s.jsonPath.replace(/^\.\//, '');
        host.appendChild(chip);
    }
}
