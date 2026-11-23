/* The door with a suffix.
 *
 * Apps build their endpoint by appending /v1/chat/completions to whatever base
 * address a person pasted, and a vp key's base address is https://api.terg.hr/vp.
 * So the path arrives as /vp/v1/chat/completions, and it must land in the same
 * door. This file exists for that sentence and nothing else.
 */
export { onRequestOptions, onRequestPost } from '../vp.js';
