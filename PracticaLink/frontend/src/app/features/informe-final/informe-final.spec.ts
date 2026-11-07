import { TestBed, ComponentFixture } from '@angular/core/testing';
import { HttpErrorResponse, HttpEvent, HttpEventType, HttpResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { Subject, of, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { InformeFinal } from './informe-final';
import { Informe, InformeService } from './informe.service';

const actual: Informe = { id_practica: 7, estado: 'ENTREGADO', version: 1, id_documento: 9,
  nombre: 'informe.pdf', tamano: 20, fecha: '2026-11-08', habilitada: true, fecha_habilitada: '2026-11-07' };

describe('Informe final: sección académica', () => {
  let fixture: ComponentFixture<InformeFinal>;
  let api: jasmine.SpyObj<InformeService>;
  beforeEach(async () => {
    api = jasmine.createSpyObj<InformeService>('InformeService', ['consultar', 'entregar', 'descargar']);
    api.consultar.and.returnValue(of(actual));
    await TestBed.configureTestingModule({ imports: [InformeFinal], providers: [{ provide: InformeService, useValue: api }] }).compileComponents();
    fixture = TestBed.createComponent(InformeFinal);
    fixture.componentRef.setInput('idPractica', 7); fixture.componentRef.setInput('estudiante', true);
    fixture.detectChanges();
  });
  afterEach(() => fixture.destroy());
  it('consulta disponibilidad y versión vigente con carga controlada', () => {
    const pending = new Subject<Informe>(); api.consultar.and.returnValue(pending);
    fixture.componentInstance.cargar(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Consultando informe');
    pending.next(actual); fixture.detectChanges();
    expect(api.consultar).toHaveBeenCalledOnceWith(7);
    expect(fixture.nativeElement.textContent).toContain('Versión: 1');
    expect(fixture.nativeElement.textContent).toContain('Reemplazar informe');
  });
  it('muestra SIN_ENTREGAR y fecha sin ofrecer reemplazo si no está habilitado', () => {
    api.consultar.and.returnValue(of({ ...actual, estado: 'SIN_ENTREGAR', version: 0, id_documento: null, habilitada: false }));
    fixture.componentInstance.cargar(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('SIN_ENTREGAR');
    expect(fixture.nativeElement.textContent).toContain('2026-11-07');
    expect(fixture.nativeElement.querySelector('input[type=file]')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Descargar informe vigente');
  });
  it('las vistas de consulta no ofrecen controles de entrega', () => {
    fixture.componentRef.setInput('estudiante', false); fixture.detectChanges();
    fixture.componentInstance.cargar(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Descargar informe vigente');
    expect(fixture.nativeElement.querySelector('input[type=file]')).toBeNull();
    fixture.componentInstance.archivo = new File(['x'], 'informe.pdf'); fixture.componentInstance.entregar();
    expect(api.entregar).not.toHaveBeenCalled();
  });
  it('mantiene clave y versión en reintentos; bloquea doble envío y refresca tras confirmar', () => {
    const panel = fixture.componentInstance; panel.cargar();
    panel.archivo = new File(['synthetic'], 'informe.pdf', { type: 'application/pdf' });
    api.entregar.and.returnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    panel.entregar(); const first = api.entregar.calls.mostRecent().args;
    const pending = new Subject<HttpEvent<{ version: number }>>(); api.entregar.and.returnValue(pending);
    panel.entregar(); panel.entregar();
    expect(api.entregar).toHaveBeenCalledTimes(2);
    expect(api.entregar.calls.mostRecent().args).toEqual(first);
    pending.next({ type: HttpEventType.UploadProgress, loaded: 5, total: 10 });
    expect(panel.progreso()).toBe(50);
    pending.next(new HttpResponse({ body: { version: 2 } })); fixture.detectChanges();
    expect(panel.enviando()).toBeFalse();
    expect(api.consultar).toHaveBeenCalledTimes(2);
    expect(fixture.nativeElement.textContent).toContain('La entrega no implica aprobación ni cierre');
  });
  it('bloquea entrega durante EN_EVALUACION', () => {
    api.consultar.and.returnValue(of({ ...actual, estado: 'EN_EVALUACION', habilitada: false }));
    fixture.componentInstance.cargar(); fixture.componentInstance.archivo = new File(['x'], 'informe.pdf');
    fixture.componentInstance.entregar(); fixture.detectChanges();
    expect(api.entregar).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('input[type=file]')).toBeNull();
  });
  for (const status of [403, 409, 413, 422, 503]) {
    it(`presenta error ${status} y permite nueva consulta`, () => {
      api.consultar.and.returnValue(throwError(() => new HttpErrorResponse({ status })));
      fixture.componentInstance.cargar(); fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[role=alert]')).not.toBeNull();
      expect(fixture.componentInstance.cargando()).toBeFalse();
      api.consultar.and.returnValue(of(actual)); fixture.componentInstance.cargar(); fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[role=alert]')).toBeNull();
    });
  }
  it('descarta respuestas de la práctica anterior y limpia datos al cambiar identificador', () => {
    const pending = new Subject<Informe>(); api.consultar.and.returnValue(pending);
    fixture.componentInstance.cargar();
    fixture.componentRef.setInput('idPractica', 8); fixture.detectChanges();
    expect(pending.observed).toBeFalse(); pending.next(actual);
    expect(fixture.componentInstance.informe()).toBeNull();
    expect(fixture.componentInstance.archivo).toBeNull();
  });
});

describe('InformeService: contrato HTTP aislado', () => {
  let api: InformeService; let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(InformeService); http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  it('envía bytes y claves sin identidad de actor ni ruta Storage', () => {
    const file = new File(['synthetic'], 'informe.pdf', { type: 'application/pdf' });
    api.entregar(7, file, 'synthetic-key', 1).subscribe();
    const request = http.expectOne(`${environment.apiUrl}/practicas/7/informe-final`);
    expect(request.request.method).toBe('POST'); expect(request.request.body).toBe(file);
    expect(request.request.headers.get('Idempotency-Key')).toBe('synthetic-key');
    expect(request.request.headers.get('Version-Esperada')).toBe('1');
    expect(request.request.headers.has('Id-Actor')).toBeFalse();
    request.flush({ version: 2 });
  });
  it('descarga bytes desde FastAPI sin URL pública ni firmada', () => {
    api.descargar(7).subscribe(blob => expect(blob.type).toBe('application/pdf'));
    const request = http.expectOne(`${environment.apiUrl}/practicas/7/informe-final/archivo`);
    expect(request.request.responseType).toBe('blob'); request.flush(new Blob(['synthetic'], { type: 'application/pdf' }));
  });
});
