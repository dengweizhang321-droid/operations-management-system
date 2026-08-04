import { env } from "cloudflare:workers";

import {
  optimizeAnnotationImageForModel,
  type AnnotationImageForModel,
  type AnnotationImagesBinding,
} from "@/lib/market/annotation-model-image";

export function annotationImagesBinding() {
  const binding = env.IMAGES as AnnotationImagesBinding | undefined;
  return binding && typeof binding.input === "function" ? binding : undefined;
}

export function optimizeAnnotationImageWithRuntime<T extends AnnotationImageForModel>(image: T) {
  return optimizeAnnotationImageForModel(image, annotationImagesBinding());
}
