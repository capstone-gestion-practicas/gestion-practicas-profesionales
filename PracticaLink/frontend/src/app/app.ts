import {
  AfterViewInit,
  Component,
  OnDestroy,
  ViewChild,
  signal
} from '@angular/core';
import { Router } from '@angular/router';
import {
  IonApp,
  IonRouterOutlet,
  ModalController,
  Platform
} from '@ionic/angular';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-root',
  imports: [IonApp, IonRouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements AfterViewInit, OnDestroy {
  @ViewChild(IonRouterOutlet, { static: true })
  private routerOutlet!: IonRouterOutlet;

  protected readonly title = signal('practicalink-frontend');
  private backButtonSubscription?: Subscription;

  constructor(
    private readonly platform: Platform,
    private readonly modalController: ModalController,
    private readonly router: Router
  ) {}

  async ngAfterViewInit(): Promise<void> {
    await this.platform.ready();
    this.backButtonSubscription = this.platform.backButton.subscribeWithPriority(
      101,
      async () => {
        const modal = await this.modalController.getTop();
        if (modal) {
          await modal.dismiss(undefined, 'back');
          return;
        }

        if (this.routerOutlet.canGoBack()) {
          await this.routerOutlet.pop();
          return;
        }

        const rutaActual = this.router.url.split('?')[0];
        if (rutaActual !== '/home' && rutaActual !== '/login') {
          await this.router.navigateByUrl('/home');
        }
      }
    );
  }

  ngOnDestroy(): void {
    this.backButtonSubscription?.unsubscribe();
  }
}
