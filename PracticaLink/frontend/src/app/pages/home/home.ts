import { Component, OnInit, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { forkJoin } from 'rxjs';

import {
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonContent,
  IonGrid,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonCol,
  IonRow,
  IonSpinner,
  ModalController
} from '@ionic/angular';

import { AuthService } from '../../core/services/auth.service';
import { PracticaService } from '../../core/services/practica.service';
import { AuthStore } from '../../core/store/auth.store';
import { SesionService } from '../../core/session/sesion.service';
import { ContextoUsuarioResponse } from '../../core/models/auth.models';
import {
  EstudianteSinPractica,
  PracticaEstadoResumen
} from '../../core/models/practica.models';
import { UsuarioService } from '../../core/services/usuario.service';
import { RevisionService } from '../../core/services/revision.service';
import { UsuarioAdministrable } from '../../core/models/usuario.models';
import { SolicitudRevisionResumen } from '../../core/models/revision.models';
import { SolicitudesPendientesModal } from '../solicitudes-pendientes-modal/solicitudes-pendientes-modal';
import { SolicitudDetalleModal } from '../solicitud-detalle-modal/solicitud-detalle-modal';
import { NotificacionService } from '../../features/notificaciones/services/notificacion.service';
import { esEspacioGestorDedicado } from '../../core/navigation/espacio-gestor';
import { GestorHome } from './gestor-home/gestor-home';

export type EstadoCargaMetrica = 'cargando' | 'listo' | 'error';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    CommonModule,
    GestorHome,
    IonContent,
    IonGrid,
    IonRow,
    IonCol,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardContent,
    IonButton,
    IonItem,
    IonLabel,
    IonList,
    IonNote,
    IonSpinner
  ],
  templateUrl: './home.html',
  styleUrl: './home.scss'
})
export class Home implements OnInit {

  private readonly authService = inject(AuthService);
  private readonly practicaService = inject(PracticaService);
  private readonly authStore = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly sesion = inject(SesionService);
  private readonly modalController = inject(ModalController);
  private readonly notificacionService = inject(NotificacionService);
  private readonly usuarioService = inject(UsuarioService);
  private readonly revisionService = inject(RevisionService);


  readonly contexto = this.authStore.contexto;
  readonly notificacionesNoLeidas = this.notificacionService.noLeidas;
  readonly saludo = computed(() => {
    const contexto = this.contexto();

    if (!contexto) {
      return '';
    }

    const nombre = contexto.usuario.nombre;
    const roles = contexto.roles.length > 0
      ? contexto.roles.join(', ')
      : 'sin rol asignado';

    return `Hola, ${nombre}. Estás logueado como ${roles}.`;
  });
  readonly puedeRevisarPracticas = computed(() => {
    const roles = this.contexto()?.roles ?? [];
    return roles.includes('GESTOR') && sessionStorage.getItem('practicalink-workspace') !== 'ADMINISTRADOR';
  });
  /** Tiene el rol GESTOR, requerido por los endpoints de solicitudes (independiente del workspace). */
  readonly tieneRolGestor = computed(() => (this.contexto()?.roles ?? []).includes('GESTOR'));
  /** Barra de accesos: la ven GESTOR o ADMINISTRADOR; cada botón se filtra por rol. */
  readonly mostrarAccesosGestion = computed(() => this.puedeRevisarPracticas() || this.esAdministrador());
  /** Usuarios con doble rol (estudiante y gestión): pueden abrir el espacio V3 del estudiante. */
  readonly tieneEspacioEstudiante = computed(() => {
    const roles = this.contexto()?.roles ?? [];
    return roles.includes('ESTUDIANTE') && (roles.includes('GESTOR') || roles.includes('ADMINISTRADOR'));
  });

  readonly esAdministrador = computed(() => {
    const roles = this.contexto()?.roles ?? [];
    const seleccionado = sessionStorage.getItem('practicalink-workspace');
    return roles.includes('ADMINISTRADOR') && seleccionado !== 'GESTOR';
  });
  /** Gestor sin administración: su espacio operativo lo presenta GestorHome dentro de GestorLayout. */
  readonly espacioGestorDedicado = computed(() => {
    const roles = this.contexto()?.roles ?? [];
    return esEspacioGestorDedicado(this.contexto())
      || (roles.includes('GESTOR') && sessionStorage.getItem('practicalink-workspace') === 'GESTOR');
  });
  cargando = true;
  usuariosAdmin: UsuarioAdministrable[] = [];
  estudiantesSinPractica: EstudianteSinPractica[] = [];
  errorEstudiantesSinPractica = '';
  recordatoriosEnCurso = new Set<number>();
  resultadoRecordatorios: Record<number, { mensaje: string; error: boolean }> = {};
  solicitudesAdmin: SolicitudRevisionResumen[] = [];
  practicasAdmin: PracticaEstadoResumen[] = [];
  metricasPracticasEstado: { id_estado: number; nombre: string; cantidad: number }[] = [];
  /** Estado de carga independiente por métrica: un fallo no invalida las demás. */
  estadoUsuarios: EstadoCargaMetrica = 'cargando';
  estadoSolicitudes: EstadoCargaMetrica = 'cargando';
  estadoPracticasEstado: EstadoCargaMetrica = 'cargando';

  ngOnInit(): void {
    const token = sessionStorage.getItem('access_token');

    if (!token) {
      this.cargando = false;
      this.router.navigate(['/login']);
      return;
    }

    if (this.contexto()) {
      this.cargando = false;
      if (this.esAdministrador()) {
        this.cargarDashboardAdmin();
        this.cargarEstudiantesSinPractica();
      }
      return;
    }

    this.authService.obtenerContexto().subscribe({
      next: (contexto) => {
        this.authStore.setContexto(contexto);
        this.cargando = false;
        if (this.esAdministrador()) {
          this.cargarDashboardAdmin();
          this.cargarEstudiantesSinPractica();
        }
      },
      error: () => {
        this.cerrarSesion();
      }
    });
  }

  /*
   * Sustitución de ionViewWillEnter: /home vive bajo GestorLayout y Ionic no dispara ese
   * hook en rutas anidadas. Cada entrada crea una instancia nueva, así que ngOnInit recarga
   * los datos (dashboard del administrador y estudiantes sin práctica). GestorHome carga
   * sus datos en su propio ngOnInit. No hay consultas por cada NavigationEnd.
   */

  cerrarSesion(): void {
    this.sesion.cerrar();
  }

  /** Espacio V3 del estudiante con doble rol: navegación real a /estudiante/inicio. */
  irAEspacioEstudiante(): void {
    void this.router.navigate(['/estudiante/inicio']);
  }

  revisarPracticas(): void {
    this.router.navigate(['/revisiones']);
  }

  gestionarEstados(): void {
    this.router.navigate(['/gestion-estados']);
  }

  gestionarSeguimientos(): void {
    this.router.navigate(['/seguimientos']);
  }

  gestionarIncidencias(): void {
    this.router.navigate(['/incidencias']);
  }

  enviarNotificaciones(): void {
    this.router.navigate(['/envio-notificaciones']);
  }

  abrirPracticasEstado(estado: string): void {
    this.router.navigate(['/gestion-estados'], {
      queryParams: { estado: estado.toUpperCase() }
    });
  }

  gestionarUsuarios(): void {
    this.router.navigate(['/usuarios']);
  }

  abrirCentroNotificaciones(): void {
    this.router.navigate(['/notificaciones']);
  }

  async abrirSolicitudesPendientes(): Promise<void> {
    const modal = await this.modalController.create({
      component: SolicitudesPendientesModal,
      componentProps: { solicitudes: this.solicitudesPendientesLista() },
      cssClass: 'requests-modal'
    });
    await modal.present();
    const { data } = await modal.onDidDismiss<{ irARevisiones?: boolean; idPractica?: number }>();
    if (data?.idPractica) {
      await this.router.navigate(['/revisiones', data.idPractica]);
    } else if (data?.irARevisiones) {
      await this.router.navigate(['/revisiones']);
    }
  }

  async abrirDetalleSolicitud(idPractica: number): Promise<void> {
    const modal = await this.modalController.create({
      component: SolicitudDetalleModal,
      componentProps: { idPractica },
      cssClass: 'request-detail-modal'
    });
    await modal.present();
  }

  solicitudesPendientes(): number {
    return this.solicitudesPendientesLista().length;
  }

  solicitudesPendientesLista(): SolicitudRevisionResumen[] {
    return this.solicitudesAdmin.filter(solicitud =>
      !['APROBADA', 'RECHAZADA'].includes(solicitud.estado.toUpperCase())
    );
  }

  usuariosActivos(): number {
    return this.usuariosAdmin.filter(usuario => usuario.activo).length;
  }

  gestoresActivos(): number {
    return this.usuariosAdmin.filter(usuario =>
      usuario.activo && usuario.roles.includes('GESTOR')
    ).length;
  }

  nombreEstado(estado: string): string {
    return estado.replaceAll('_', ' ');
  }

  solicitudesRecientes(): PracticaEstadoResumen[] {
    return [...this.practicasAdmin]
      .sort((a, b) => b.fecha_registro.localeCompare(a.fecha_registro))
      .slice(0, 5);
  }

  private cargarDashboardAdmin(): void {
    if (!this.esAdministrador()) {
      return;
    }

    // Cada métrica tiene su propia petición y su propio estado: un fallo no invalida las demás.
    this.estadoUsuarios = 'cargando';
    this.usuarioService.listar().subscribe({
      next: usuarios => {
        this.usuariosAdmin = usuarios;
        this.estadoUsuarios = 'listo';
      },
      error: () => {
        this.usuariosAdmin = [];
        this.estadoUsuarios = 'error';
      }
    });

    this.estadoPracticasEstado = 'cargando';
    forkJoin({
      estados: this.practicaService.listarEstados(),
      practicas: this.practicaService.listarPracticasParaGestion()
    }).subscribe({
      next: ({ estados, practicas }) => {
        this.practicasAdmin = practicas;
        this.metricasPracticasEstado = this.contarPracticasPorEstado(estados, practicas);
        this.estadoPracticasEstado = 'listo';
      },
      error: () => {
        this.practicasAdmin = [];
        this.metricasPracticasEstado = [];
        this.estadoPracticasEstado = 'error';
      }
    });

    // /revisiones/* exige GESTOR en el backend: solo se consulta si el usuario tiene ese rol.
    if (this.tieneRolGestor()) {
      this.cargarSolicitudesAdmin();
    } else {
      this.solicitudesAdmin = [];
      this.estadoSolicitudes = 'listo';
    }
  }

  private cargarSolicitudesAdmin(): void {
    this.estadoSolicitudes = 'cargando';
    this.revisionService.listar().subscribe({
      next: solicitudes => {
        this.solicitudesAdmin = solicitudes;
        this.estadoSolicitudes = 'listo';
      },
      error: () => {
        this.solicitudesAdmin = [];
        this.estadoSolicitudes = 'error';
      }
    });
  }

  /** Texto visible de una métrica: nunca muestra un cero cuando la carga falló. */
  textoMetrica(estado: EstadoCargaMetrica, valor: number): string {
    if (estado === 'error') {
      return 'No disponible';
    }
    return estado === 'cargando' ? '…' : String(valor);
  }

  /** Solo el dashboard del administrador usa este aviso; el gestor lo carga en GestorHome. */
  private cargarEstudiantesSinPractica(): void {
    if (!this.esAdministrador()) {
      return;
    }

    this.errorEstudiantesSinPractica = '';
    this.practicaService.listarEstudiantesSinPractica().subscribe({
      next: estudiantes => {
        this.estudiantesSinPractica = estudiantes;
      },
      error: () => {
        this.errorEstudiantesSinPractica =
          'No fue posible consultar los estudiantes sin práctica registrada.';
      }
    });
  }

  enviarRecordatorioEstudiante(idUsuario: number): void {
    this.resultadoRecordatorios = {
      ...this.resultadoRecordatorios,
      [idUsuario]: { mensaje: '', error: false }
    };
    this.recordatoriosEnCurso.add(idUsuario);
    this.practicaService.enviarRecordatorioEstudiante(idUsuario).subscribe({
      next: resultado => {
        this.recordatoriosEnCurso.delete(idUsuario);
        this.resultadoRecordatorios = {
          ...this.resultadoRecordatorios,
          [idUsuario]: { mensaje: resultado.mensaje, error: false }
        };
        this.cargarEstudiantesSinPractica();
      },
      error: (error: HttpErrorResponse) => {
        this.recordatoriosEnCurso.delete(idUsuario);
        const detalle = typeof error.error?.detail === 'string'
          ? error.error.detail
          : 'No fue posible enviar el recordatorio.';
        this.resultadoRecordatorios = {
          ...this.resultadoRecordatorios,
          [idUsuario]: { mensaje: detalle, error: true }
        };
      }
    });
  }

  private contarPracticasPorEstado(
    estados: { id_estado: number; nombre: string }[],
    practicas: PracticaEstadoResumen[]
  ): { id_estado: number; nombre: string; cantidad: number }[] {
    const cantidades = new Map<string, number>();
    for (const practica of practicas) {
      const nombre = practica.estado.toUpperCase();
      cantidades.set(nombre, (cantidades.get(nombre) ?? 0) + 1);
    }

    const metricas = estados.map(estado => ({
      id_estado: estado.id_estado,
      nombre: estado.nombre,
      cantidad: cantidades.get(estado.nombre.toUpperCase()) ?? 0
    }));
    const estadosNoActivos = new Map<string, { id_estado: number; nombre: string; cantidad: number }>();
    for (const practica of practicas) {
      const clave = practica.estado.toUpperCase();
      if (!estados.some(estado => estado.nombre.toUpperCase() === clave)) {
        const actual = estadosNoActivos.get(clave);
        estadosNoActivos.set(clave, {
          id_estado: practica.id_estado,
          nombre: practica.estado,
          cantidad: (actual?.cantidad ?? 0) + 1
        });
      }
    }
    return [...metricas, ...estadosNoActivos.values()];
  }

}
