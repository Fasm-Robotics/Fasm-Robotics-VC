import { ComponentFixture, TestBed } from '@angular/core/testing';

import { UrdfViewerComponent } from './urdf-viewer.component';

describe('UrdfViewerComponent', () => {
  let component: UrdfViewerComponent;
  let fixture: ComponentFixture<UrdfViewerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UrdfViewerComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(UrdfViewerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
