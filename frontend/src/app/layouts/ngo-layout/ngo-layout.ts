import { Component, inject, OnInit, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { ProfileService } from '../../core/profiles/profile.service';
import { NgoVerificationStatus } from '../../core/verification/verification.models';
import { NotificationCenter } from '../../shared/notifications/notification-center';

@Component({ selector: 'app-ngo-layout', imports: [RouterLink, RouterLinkActive, RouterOutlet, NotificationCenter], templateUrl: './ngo-layout.html' })
export class NgoLayout implements OnInit {
  protected readonly auth = inject(AuthService);
  protected readonly ngoName = signal('Your organization');
  protected readonly verificationStatus = signal<NgoVerificationStatus | null>(null);
  protected readonly menuOpen = signal(false);
  private readonly profile = inject(ProfileService);
  private readonly router = inject(Router);
  ngOnInit(): void {
    this.profile.getNgoProfile().subscribe({ next: (response) => { this.ngoName.set(response.data.name); this.verificationStatus.set(response.data.verification_status); } });
  }
  protected closeMenu(): void { this.menuOpen.set(false); }
  protected statusLabel(status: NgoVerificationStatus | null): string { return status?.replaceAll('_', ' ') ?? 'Profile needed'; }
  protected logout(): void { this.auth.logout(); void this.router.navigateByUrl('/'); }
}
