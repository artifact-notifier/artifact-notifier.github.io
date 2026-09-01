import { Component, input } from '@angular/core';

@Component({
  selector: 'eco-icon',
  standalone: true,
  template: `
    @switch (ecosystem()) {
      @case ('NPM') {
        <img
          src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/npm/npm-original.svg"
          alt="npm" width="32" height="32" class="eco-img" loading="eager"
        />
      }
      @case ('MAVEN') {
        <img
          src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/maven/maven-original.svg"
          alt="Maven" width="32" height="32" class="eco-img" loading="eager"
        />
      }
      @case ('PYPI') {
        <img
          src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/pypi/pypi-original.svg"
          alt="PyPI" width="32" height="32" class="eco-img" loading="eager"
        />
      }
      @case ('TEST') {
        <span class="test-icon" role="img" aria-label="TEST">🧪</span>
      }
    }
  `,
  styles: `
    :host { display: inline-flex; vertical-align: middle; align-items: center; }
    .eco-img { display: block; width: 32px; height: 32px; object-fit: contain; }
    .test-icon { font-size: 24px; line-height: 32px; width: 32px; text-align: center; }
  `,
})
export class EcoIconComponent {
  ecosystem = input.required<'NPM' | 'MAVEN' | 'PYPI' | 'TEST'>();
}
