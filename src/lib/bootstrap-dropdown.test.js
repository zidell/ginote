import { describe, expect, it } from 'vitest';
import Dropdown from 'bootstrap/js/dist/dropdown';
import { disposeDropdownOnDestroy, hideDropdown } from './bootstrap-dropdown.js';

function toggle() {
  const wrapper = document.createElement('div');
  wrapper.className = 'dropdown';
  wrapper.innerHTML = '<button data-bs-toggle="dropdown"></button><ul class="dropdown-menu"></ul>';
  document.body.append(wrapper);
  return wrapper.querySelector('button');
}

describe('bootstrap-dropdown', () => {
  it('releases the instance Bootstrap keeps for a toggle when the toggle goes away', () => {
    const button = toggle();
    const action = disposeDropdownOnDestroy(button);
    Dropdown.getOrCreateInstance(button);
    expect(Dropdown.getInstance(button)).not.toBeNull();
    action.destroy();
    expect(Dropdown.getInstance(button)).toBeNull();
    button.parentElement.remove();
  });

  it('does not create an instance just to hide a menu that never opened', () => {
    const button = toggle();
    hideDropdown(button);
    hideDropdown(null);
    expect(Dropdown.getInstance(button)).toBeNull();
    button.parentElement.remove();
  });
});
