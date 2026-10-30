import { ACCEPTED_TYPES } from '../store/assets';
import { addImageFiles, type DropTarget } from './actions';

/** Opens the system file picker for images; files go to `target` (or the default placement). */
export function pickImages(target?: DropTarget): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = ACCEPTED_TYPES.join(',');
  input.multiple = true;
  input.onchange = () => {
    const files = [...(input.files ?? [])];
    if (files.length) void addImageFiles(files, target);
  };
  input.click();
}
