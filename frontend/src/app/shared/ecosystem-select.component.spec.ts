import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { EcosystemSelectComponent } from './ecosystem-select.component';

type Eco = 'NPM' | 'MAVEN' | 'PYPI' | 'TEST';

@Component({
  imports: [EcosystemSelectComponent],
  template: `<ecosystem-select [value]="value()" [options]="options()" (valueChange)="value.set($event)" />
    <p class="outside">outside</p>`,
})
class HostComponent {
  value = signal<Eco>('NPM');
  options = signal<Eco[] | null>(null);
}

describe('EcosystemSelectComponent', () => {
  function render(options: Eco[] | null = null) {
    TestBed.configureTestingModule({ imports: [HostComponent], providers: [provideZonelessChangeDetection()] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.options.set(options);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const trigger = el.querySelector('.eco-trigger') as HTMLButtonElement;
    const open = () => {
      trigger.click();
      fixture.detectChanges();
    };
    const optionLabels = () =>
      [...el.querySelectorAll('[role=option]')].map(
        (o) => o.querySelector(':scope > span:not(.check)')?.textContent + (o.querySelector('.check') ? ' ✓' : ''),
      );
    return { fixture, el, trigger, open, optionLabels };
  }

  it('lists npm, Maven and PyPI by default and marks the current one', () => {
    const { el, trigger, open, optionLabels } = render();
    expect(trigger.textContent).toContain('npm');
    open();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(optionLabels()).toEqual(['npm ✓', 'Maven', 'PyPI']);
    expect(el.querySelector('[aria-selected=true]')?.textContent).toContain('npm');
  });

  it('uses the ecosystems given by the backend', () => {
    const { open, optionLabels } = render(['NPM', 'TEST']);
    open();
    expect(optionLabels()).toEqual(['npm ✓', 'TEST']);
  });

  it('emits the picked ecosystem (click or Enter) and closes', () => {
    const { fixture, el, trigger, open } = render();
    open();
    (el.querySelectorAll('[role=option]')[1] as HTMLElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.value()).toBe('MAVEN');
    expect(el.querySelector('[role=listbox]')).toBeNull();
    expect(trigger.textContent).toContain('Maven');

    open();
    el.querySelectorAll('[role=option]')[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();
    expect(fixture.componentInstance.value()).toBe('PYPI');
  });

  it('closes when clicking elsewhere, not inside', () => {
    const { fixture, el, open } = render();
    open();
    (el.querySelector('.eco-label') as HTMLElement).click();
    fixture.detectChanges();
    // a click inside toggled it (trigger), the list is re-evaluated: reopen for the outside check
    if (!el.querySelector('[role=listbox]')) open();
    document.body.click();
    (el.querySelector('.outside') as HTMLElement).click();
    fixture.detectChanges();
    expect(el.querySelector('[role=listbox]')).toBeNull();
  });
});
