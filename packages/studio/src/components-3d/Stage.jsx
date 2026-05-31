import * as React from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

const MIN_CAMERA_RANGE = 5000;

const updateCameraClipping = (camera, radius, center) => {
  if (!Number.isFinite(radius) || radius <= 0) return false;

  const focusPoint = center || new THREE.Vector3();
  const distanceToFocus = camera.position.distanceTo(focusPoint);
  const range = Math.max(
    MIN_CAMERA_RANGE,
    distanceToFocus + radius * 2,
    radius * 6
  );

  if (camera.type === "OrthographicCamera") {
    const near = -range;
    const far = range;

    if (camera.near === near && camera.far === far) {
      return false;
    }

    camera.near = near;
    camera.far = far;
    camera.updateProjectionMatrix();
    return true;
  }

  const near = Math.max(0.1, Math.min(distanceToFocus / 100, radius / 10));
  const far = range;

  if (camera.near === near && camera.far === far) {
    return false;
  }

  camera.near = near;
  camera.far = far;
  camera.updateProjectionMatrix();
  return true;
};

export default function Stage({
  children,
  center,
  controls,
  ...props
}) {
  const camera = useThree((state) => state.camera);
  const { invalidate } = useThree();
  const outer = React.useRef(null);
  const inner = React.useRef(null);
  const modelCenter = React.useRef(new THREE.Vector3());

  const [{ radius, previousRadius, top }, set] = React.useState({
    previousRadius: null,
    radius: 0,
    top: 0,
  });

  React.useLayoutEffect(() => {
    let raf = null;

    const updateBounds = () => {
      if (!outer.current || !inner.current) return 0;

      outer.current.updateWorldMatrix(true, true);
      const box3 = new THREE.Box3().setFromObject(inner.current);

      if (center) {
        const centerPoint = new THREE.Vector3();
        box3.getCenter(centerPoint);
        outer.current.position.set(-centerPoint.x, -centerPoint.y, -centerPoint.z);
        outer.current.updateWorldMatrix(true, true);
        box3.setFromObject(inner.current);
      }

      const sphere = new THREE.Sphere();
      box3.getBoundingSphere(sphere);
      modelCenter.current.copy(sphere.center);

      set((prev) => ({
        radius: sphere.radius,
        previousRadius: prev.radius,
        top: box3.max.z,
      }));

      return sphere.radius;
    };

    const measuredRadius = updateBounds();

    // Geometry buffers are populated in child layout effects; a next-frame
    // remeasure avoids ending up with radius=0 on initial load.
    if (!measuredRadius) {
      raf = requestAnimationFrame(updateBounds);
    }

    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, [children, center]);

  useFrame(() => {
    if (updateCameraClipping(camera, radius, modelCenter.current)) {
      invalidate();
    }
  });

  React.useLayoutEffect(() => {
    if (previousRadius && previousRadius !== radius) {
      const ratio = radius / previousRadius;
      camera.position.set(
        camera.position.x * ratio,
        camera.position.y * ratio,
        camera.position.z * ratio
      );

      updateCameraClipping(camera, radius, modelCenter.current);

      invalidate();
      return;
    }

    camera.position.set(
      radius * 0.25,
      -radius * 1.5,
      Math.max(top, radius) * 1.5
    );
    updateCameraClipping(camera, radius, modelCenter.current);
    camera.lookAt(0, 0, 0);

    if (camera.type === "OrthographicCamera") {
      camera.position.set(radius, -radius, radius);

      camera.zoom = 5;
      updateCameraClipping(camera, radius, modelCenter.current);
      camera.updateProjectionMatrix();
    }

    invalidate();
  }, [radius, top, previousRadius]);

  return (
    <group {...props}>
      <group ref={outer}>
        <group ref={inner}>{children}</group>
      </group>
    </group>
  );
}
