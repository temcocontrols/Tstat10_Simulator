// events.js: Key event handlers and event dispatch logic for LCD simulator
import { moveRedboxZigzag } from './coords.js';
import { renderNetworkSettings } from './network-settings-renderer.js';

// Handle arrow key events for redbox movement
export function handleRedboxArrowKey(e) {
    // Completely disconnect up/down from redbox movement for now
    return false;
}