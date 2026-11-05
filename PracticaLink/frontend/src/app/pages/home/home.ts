import { Component, OnInit, computed, effect, inject } from '@angular/core';
import { addIcons } from 'ionicons';
import {
  briefcaseOutline,
  documentTextOutline,
  helpCircleOutline,
  homeOutline,
  logOutOutline,
  notificationsOutline
} from 'ionicons/icons';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
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
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonModal,
  IonNote,
  IonCol,
  IonRow,
  IonSpinner,
  IonIcon,
  IonTextarea,
  ModalController
} from '@ionic/angular';

import { AuthService } from '../../core/services/auth.service';
import { PracticaService } from '../../core/services/practica.service';
import { AuthStore } from '../../core/store/auth.store';
import { ContextoUsuarioResponse } from '../../core/models/auth.models';
import {
  HistorialEstadoPractica,
  EstudianteSinPractica,
  PracticaDetalleResponse,
  PracticaEstadoResumen
} from '../../core/models/practica.models';
import { formatearRut, rutValido } from '../../core/validators/rut.validator';
import { PracticaForm } from '../practica-form/practica-form';
import { UsuarioService } from '../../core/services/usuario.service';
import { RevisionService } from '../../core/services/revision.service';
import { UsuarioAdministrable } from '../../core/models/usuario.models';
import { SolicitudRevisionResumen } from '../../core/models/revision.models';
import { SolicitudesPendientesModal } from '../solicitudes-pendientes-modal/solicitudes-pendientes-modal';
import { SolicitudDetalleModal } from '../solicitud-detalle-modal/solicitud-detalle-modal';
import { NotificacionService } from '../../features/notificaciones/services/notificacion.service';
import { formatoHorasEstimadas } from '../../core/utils/horas-estimadas';
import { EstadoBadge } from '../../shared/components/estado-badge/estado-badge';
import { PerfilEstudianteWorkflowService } from '../../features/estudiante/services/perfil-estudiante-workflow.service';

/** Mensajes informativos del estudiante. Solo describen el estado recibido; no crean acciones. */
const MENSAJES_ESTADO_PRACTICA = new Map<string, string>([
  ['REGISTRADA', 'Tu práctica fue registrada.'],
  ['EN_REVISION', 'Tu práctica está siendo revisada.'],
  ['OBSERVADA', 'Tu práctica tiene observaciones. Responde para que vuelva a revisión.'],
  ['APROBADA', 'Tu práctica fue aprobada.'],
  ['EN_CURSO', 'Tu práctica está en curso.'],
  ['FINALIZADA', 'Tu práctica finalizó.'],
  ['RECHAZADA', 'Tu práctica fue rechazada. Puedes consultar el historial para revisar las observaciones disponibles.']
]);
const MENSAJE_ESTADO_DESCONOCIDO =
  'No pudimos identificar el estado actual de tu práctica. Puedes consultar el historial para obtener más información.';
const MENSAJE_ERROR_ANTECEDENTES_404 =
  'No pudimos cargar los antecedentes de tu práctica. Intenta nuevamente más tarde.';
const MENSAJE_ERROR_ANTECEDENTES =
  'No fue posible cargar los antecedentes de tu práctica.';
const MENSAJE_ERROR_ACTUALIZACION_TRAS_RESPUESTA =
  'Tu respuesta fue enviada, pero no pudimos actualizar la información de tu práctica. Recarga la pantalla para ver la información más reciente.';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonContent,
    IonGrid,
    IonRow,
    IonCol,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardContent,
    IonButton,
    IonInput,
    IonItem,
    IonLabel,
    IonList,
    IonModal,
    IonNote,
    IonSpinner,
    IonIcon,
    IonTextarea,
    EstadoBadge
  ],
  templateUrl: './home.html',
  styleUrls: ['./home.scss', './home-student.scss']
})
export class Home implements OnInit {

  private readonly authService = inject(AuthService);
  private readonly practicaService = inject(PracticaService);
  private readonly authStore = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly perfilEstudianteWorkflow = inject(PerfilEstudianteWorkflowService);
  private readonly modalController = inject(ModalController);
  private readonly notificacionService = inject(NotificacionService);
  private readonly usuarioService = inject(UsuarioService);
  private readonly revisionService = inject(RevisionService);

  constructor() {
    addIcons({
      homeOutline,
      briefcaseOutline,
      notificationsOutline,
      documentTextOutline,
      helpCircleOutline,
      logOutOutline
    });
  }

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
  readonly puedeRegistrarPractica = computed(() => {
    const contexto = this.contexto();
    return contexto?.roles.includes('ESTUDIANTE') === true
      && contexto.perfil !== null
      && contexto.practica_actual === null;
  });
  readonly esEstudiante = computed(
    () => this.contexto()?.roles.includes('ESTUDIANTE') === true
  );
  readonly puedeRevisarPracticas = computed(() => {
    const roles = this.contexto()?.roles ?? [];
    return roles.includes('GESTOR') || roles.includes('ADMINISTRADOR');
  });
  /** Vista de estudiante: estudiante sin gestión, o estudiante con panel de estudiante activo. */
  esVistaEstudiante(): boolean {
    return this.esEstudiante() && (!this.puedeRevisarPracticas() || this.mostrarPanelEstudiante);
  }

  irInicio(): void {
    this.router.navigate(['/home']);
  }

  /** Estado real de la práctica: detalle cargado, o estado del contexto si el detalle aún no existe. */
  esObservada(): boolean {
    const nombre = this.practicaDetalle?.estado.nombre ?? this.contexto()?.practica_actual?.estado.nombre ?? '';
    return nombre.toUpperCase() === 'OBSERVADA';
  }

  irAResponderObservacion(): void {
    document.getElementById('responder-observacion')?.scrollIntoView({ block: 'center' });
  }

  /** Estado recibido reconocido por la pantalla. Un estado desconocido no muestra líneas de acción. */
  esEstadoConocido(): boolean {
    return MENSAJES_ESTADO_PRACTICA.has(this.nombreEstadoActual());
  }

  esRechazada(): boolean {
    return this.nombreEstadoActual() === 'RECHAZADA';
  }

  /** Última observación registrada en el historial. Puede no existir. */
  ultimaObservacion(): HistorialEstadoPractica | null {
    const observaciones = this.historialEstados
      .filter(evento => evento.observacion && evento.estado.toUpperCase() === 'OBSERVADA');
    return [...observaciones].sort((a, b) => b.fecha_cambio.localeCompare(a.fecha_cambio))[0] ?? null;
  }

  abrirHistorial(): void {
    this.historialAbierto = true;
    setTimeout(() => document.getElementById('historial-estados')?.scrollIntoView({ block: 'center' }));
  }

  alternarHistorial(evento: Event): void {
    this.historialAbierto = (evento.target as HTMLDetailsElement).open;
  }

  private nombreEstadoActual(): string {
    return (this.practicaDetalle?.estado.nombre ?? this.contexto()?.practica_actual?.estado.nombre ?? '').toUpperCase();
  }

  readonly esAdministrador = computed(
    () => this.contexto()?.roles.includes('ADMINISTRADOR') === true
  );
  readonly tieneEspacioEstudiante = computed(
    () => this.esEstudiante() && this.puedeRevisarPracticas()
  );

  cargando = true;
  mostrarPanelEstudiante = false;
  errorPractica = '';
  errorSolicitudesGestion = '';
  cargandoSolicitudesGestion = false;
  practicaDetalle: PracticaDetalleResponse | null = null;
  modalAntecedentesAbierto = false;
  historialEstados: HistorialEstadoPractica[] = [];
  cargandoHistorialEstados = false;
  errorHistorialEstados = '';
  respuestaObservacion = '';
  enviandoRespuestaObservacion = false;
  errorRespuestaObservacion = '';
  mensajeRespuestaObservacion = '';
  errorActualizacionPractica = '';
  historialAbierto = false;
  modalPerfilAbierto = false;
  guardandoPerfil = false;
  errorPerfil = '';
  rutPerfil = '';
  carreraPerfil = '';
  sedePerfil = '';
  telefonoPerfil = '';
  direccionPerfil = '';
  usuariosAdmin: UsuarioAdministrable[] = [];
  estudiantesSinPractica: EstudianteSinPractica[] = [];
  errorEstudiantesSinPractica = '';
  recordatoriosEnCurso = new Set<number>();
  resultadoRecordatorios: Record<number, { mensaje: string; error: boolean }> = {};
  solicitudesAdmin: SolicitudRevisionResumen[] = [];
  practicasAdmin: PracticaEstadoResumen[] = [];
  metricasPracticasEstado: { id_estado: number; nombre: string; cantidad: number }[] = [];
  errorDashboardAdmin = '';
  mensajeInteraccion = '';
  private firmaContextoPracticaProcesada = '';
  private omitirPrimerIonViewWillEnter = true;

  private readonly sincronizarPracticaConContexto = effect(() => {
    const contexto = this.contexto();

    if (!contexto) {
      return;
    }

    this.cargarPracticaRegistrada(contexto);
  });

  ngOnInit(): void {
    const token = sessionStorage.getItem('access_token');

    if (!token) {
      this.cargando = false;
      this.router.navigate(['/login']);
      return;
    }

    if (this.contexto()) {
      this.cargando = false;
      this.cargarPracticaRegistrada(this.contexto() as ContextoUsuarioResponse);
      this.cargarDashboardAdmin();
      this.cargarEstudiantesSinPractica();
      this.cargarSolicitudesGestion();
      return;
    }

    this.authService.obtenerContexto().subscribe({
      next: (contexto) => {
        this.authStore.setContexto(contexto);
        this.cargando = false;
        this.cargarPracticaRegistrada(contexto);
        this.cargarDashboardAdmin();
        this.cargarEstudiantesSinPractica();
        this.cargarSolicitudesGestion();
      },
      error: () => {
        this.cerrarSesion();
      }
    });
  }

  ionViewWillEnter(): void {
    if (this.omitirPrimerIonViewWillEnter) {
      this.omitirPrimerIonViewWillEnter = false;
      return;
    }
    this.cargarDashboardAdmin();
    this.cargarEstudiantesSinPractica();
    this.cargarSolicitudesGestion();
  }

  cerrarSesion(): void {
    sessionStorage.removeItem('access_token');
    this.authStore.limpiar();
    this.router.navigate(['/login']);
  }

  async registrarPractica(): Promise<void> {
    const modal = await this.modalController.create({
      component: PracticaForm,
      cssClass: 'practice-registration-modal',
      backdropDismiss: false
    });
    await modal.present();
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

  verEspacioEstudiante(): void {
    this.mostrarPanelEstudiante = true;
  }

  verEspacioGestion(): void {
    this.mostrarPanelEstudiante = false;
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

  copiarCorreo(correo: string): void {
    if (!navigator.clipboard) {
      this.mostrarMensaje('Tu navegador no permite copiar el correo automáticamente.');
      return;
    }

    navigator.clipboard.writeText(correo).then(
      () => this.mostrarMensaje('Correo copiado al portapapeles.'),
      () => this.mostrarMensaje('No fue posible copiar el correo.')
    );
  }

  abrirAntecedentesPractica(): void {
    this.modalAntecedentesAbierto = true;
  }

  cerrarAntecedentes(): void {
    this.modalAntecedentesAbierto = false;
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

  completarPerfil(): void {
    this.errorPerfil = '';
    this.modalPerfilAbierto = true;
  }

  cerrarModalPerfil(): void {
    if (!this.guardandoPerfil) {
      this.modalPerfilAbierto = false;
      this.errorPerfil = '';
    }
  }

  guardarPerfil(): void {
    if (
      !this.rutPerfil.trim()
      || !this.carreraPerfil.trim()
      || !this.sedePerfil.trim()
    ) {
      this.errorPerfil = 'RUT, carrera y sede son obligatorios.';
      return;
    }

    if (!rutValido(this.rutPerfil)) {
      this.errorPerfil = 'Ingresa un RUT válido con dígito verificador.';
      return;
    }

    this.rutPerfil = formatearRut(this.rutPerfil);

    this.errorPerfil = '';
    this.guardandoPerfil = true;
    this.perfilEstudianteWorkflow.completar({
      rut: this.rutPerfil.trim(),
      carrera: this.carreraPerfil.trim(),
      sede: this.sedePerfil.trim(),
      telefono: this.opcional(this.telefonoPerfil),
      direccion: this.opcional(this.direccionPerfil)
    }).subscribe({
      next: () => {
        this.guardandoPerfil = false;
        this.modalPerfilAbierto = false;
      },
      error: (error: HttpErrorResponse) => {
        this.guardandoPerfil = false;
        this.errorPerfil = typeof error.error?.detail === 'string'
          ? error.error.detail
          : 'No fue posible completar el perfil.';
      }
    });
  }

  private opcional(valor: string): string | null {
    return valor.trim() || null;
  }

  private mostrarMensaje(mensaje: string): void {
    this.mensajeInteraccion = mensaje;
    window.setTimeout(() => {
      if (this.mensajeInteraccion === mensaje) {
        this.mensajeInteraccion = '';
      }
    }, 3000);
  }

  private cargarDashboardAdmin(): void {
    if (!this.esAdministrador()) {
      return;
    }

    this.errorDashboardAdmin = '';
    forkJoin({
      usuarios: this.usuarioService.listar(),
      solicitudes: this.revisionService.listar(),
      estados: this.practicaService.listarEstados(),
      practicas: this.practicaService.listarPracticasParaGestion()
    }).subscribe({
      next: ({ usuarios, solicitudes, estados, practicas }) => {
        this.usuariosAdmin = usuarios;
        this.solicitudesAdmin = solicitudes;
        this.practicasAdmin = practicas;
        this.metricasPracticasEstado = this.contarPracticasPorEstado(estados, practicas);
      },
      error: () => {
        this.errorDashboardAdmin = 'No fue posible cargar todas las métricas del dashboard.';
      }
    });
  }

  private cargarSolicitudesGestion(): void {
    if (!this.puedeRevisarPracticas() || this.esAdministrador()) {
      return;
    }

    this.cargandoSolicitudesGestion = true;
    this.errorSolicitudesGestion = '';
    this.revisionService.listar().subscribe({
      next: solicitudes => {
        this.solicitudesAdmin = solicitudes;
        this.cargandoSolicitudesGestion = false;
      },
      error: () => {
        this.errorSolicitudesGestion = 'No fue posible cargar las solicitudes por revisar.';
        this.cargandoSolicitudesGestion = false;
      }
    });
  }

  private cargarEstudiantesSinPractica(): void {
    if (!this.puedeRevisarPracticas()) {
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

  private cargarPracticaRegistrada(contexto: ContextoUsuarioResponse): void {
    const firmaContexto = this.firmaContexto(contexto);

    if (firmaContexto === this.firmaContextoPracticaProcesada) {
      return;
    }

    this.firmaContextoPracticaProcesada = firmaContexto;
    this.errorPractica = '';

    if (
      contexto.roles.includes('ESTUDIANTE') !== true
      || contexto.practica_actual === null
    ) {
      this.practicaDetalle = null;
      this.historialEstados = [];
      return;
    }

    this.practicaService.obtenerMiPractica().subscribe({
      next: (practica) => {
        this.practicaDetalle = practica;
        this.cargarHistorialEstados(practica.id_practica);
      },
      error: (error: HttpErrorResponse) => {
        this.practicaDetalle = null;

        if (error.status === 404) {
          // Sin práctica en el contexto, el 404 es esperado. Con práctica en el contexto, no debe quedar vacío.
          if (contexto.practica_actual !== null) {
            this.errorPractica = MENSAJE_ERROR_ANTECEDENTES_404;
          }
          return;
        }

        this.errorPractica = MENSAJE_ERROR_ANTECEDENTES;
      }
    });
  }

  private cargarHistorialEstados(idPractica: number): void {
    this.cargandoHistorialEstados = true;
    this.errorHistorialEstados = '';
    this.practicaService.obtenerHistorialEstados(idPractica).subscribe({
      next: historial => {
        this.historialEstados = historial;
        this.cargandoHistorialEstados = false;
      },
      error: () => {
        this.historialEstados = [];
        this.errorHistorialEstados = 'No fue posible cargar el historial de estados.';
        this.cargandoHistorialEstados = false;
      }
    });
  }

  responderObservacionEstudiante(): void {
    const practica = this.practicaDetalle;
    const respuesta = this.respuestaObservacion.trim();
    if (!practica || practica.estado.nombre.toUpperCase() !== 'OBSERVADA' || !respuesta) {
      this.errorRespuestaObservacion = 'Escribe una respuesta antes de enviarla.';
      return;
    }

    this.enviandoRespuestaObservacion = true;
    this.errorRespuestaObservacion = '';
    this.mensajeRespuestaObservacion = '';
    this.errorActualizacionPractica = '';
    this.practicaService.responderObservacion(practica.id_practica, respuesta).subscribe({
      next: resultado => {
        // El envío fue aceptado: la respuesta ya no se conserva en el formulario.
        this.enviandoRespuestaObservacion = false;
        this.respuestaObservacion = '';
        this.mensajeRespuestaObservacion = resultado.mensaje;
        this.actualizarPracticaTrasRespuesta();
      },
      error: (error: HttpErrorResponse) => {
        // Envío fallido: el texto escrito se conserva para reintentar.
        this.enviandoRespuestaObservacion = false;
        this.errorRespuestaObservacion = typeof error.error?.detail === 'string'
          ? error.error.detail
          : 'No fue posible enviar tu respuesta.';
      }
    });
  }

  mensajeEstadoPractica(nombreEstado: string): string {
    return MENSAJES_ESTADO_PRACTICA.get(nombreEstado.toUpperCase()) ?? MENSAJE_ESTADO_DESCONOCIDO;
  }

  /** Recargas posteriores a un envío exitoso: sus errores no deben confundirse con un fallo de envío. */
  private actualizarPracticaTrasRespuesta(): void {
    this.practicaService.obtenerMiPractica().subscribe({
      next: actualizada => {
        this.practicaDetalle = actualizada;
        this.cargarHistorialEstados(actualizada.id_practica);
        this.refrescarContextoTrasRespuesta();
      },
      error: () => {
        this.errorActualizacionPractica = MENSAJE_ERROR_ACTUALIZACION_TRAS_RESPUESTA;
      }
    });
  }

  private refrescarContextoTrasRespuesta(): void {
    this.authService.obtenerContexto().subscribe({
      next: contexto => {
        this.firmaContextoPracticaProcesada = '';
        this.authStore.setContexto(contexto);
      },
      error: () => {
        this.errorActualizacionPractica = MENSAJE_ERROR_ACTUALIZACION_TRAS_RESPUESTA;
      }
    });
  }

  private firmaContexto(contexto: ContextoUsuarioResponse): string {
    const idPractica = contexto.practica_actual?.id_practica ?? 'sin-practica';
    const roles = contexto.roles.join('|');

    return `${contexto.usuario.id_usuario}:${roles}:${idPractica}`;
  }

  formatearCampo(valor: string | number | null | undefined): string {
    if (valor === null || valor === undefined || valor === '') {
      return 'No informado';
    }

    return String(valor);
  }

  estimacionHorasPractica(
    fechaInicio: string | null,
    fechaTermino: string | null,
    horasSemanales: number | null
  ): string {
    return formatoHorasEstimadas(fechaInicio, fechaTermino, horasSemanales);
  }
}
