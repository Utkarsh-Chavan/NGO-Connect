import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { NotificationCenter } from '../../shared/notifications/notification-center';

@Component({
  selector: 'app-individual-layout',
  imports: [RouterLink, RouterOutlet, NotificationCenter],
  templateUrl: './individual-layout.html',
})
export class IndividualLayout {
  protected readonly auth = inject(AuthService);
  protected readonly menuOpen = signal(false);
  private readonly router = inject(Router);

  protected closeMenu(): void { this.menuOpen.set(false); }
  protected logout(): void { this.auth.logout(); void this.router.navigateByUrl('/'); }
}
