/** Reviewed producer/build side-effect scope; qualified code, never a dispatch allowlist. */
import producer from './preparation-producer-qualification.mjs';
export const retirementProducerFiles=Object.freeze({
 ...Object.fromEntries(Object.entries(producer.closures[0]).map(([name,digest])=>['tools/'+name,digest])),
 'tools/django-local-service.ps1':'65f057297208b32ac6d3c2e71a12016b1fd4afdc0ed7ea455fbda13181fffb61',
 'tools/django-ai.ps1':'f97cf7e2bc532407cdf86501de57097ce6e4f626eaf68f73ee6ab308532e0e73',
 'vite.config.ts':'9bddf1dcd573169af1009ee08bc85b16989f89b0d9fed5bbec101e3b7425c48c',
 'build/sites-vite-plugin.ts':'4b3ae653c6d0d6fda49eb5f358211b73215b36dc9e943b974bcbea6d2c1f29c6',
 'tools/install-workerd-heap-patch.mjs':'0634508859843194bf178de678c0c587a0e774f88453422833c390cc085eb392',
 'package.json':'c4c7f6a0422370d7ac7c2c75bff2ad0c77f19d507d07cc8d98dcc8440f1d5056',
 'package-lock.json':'8ec00f801aff894796d783595d202811bccbe94296603ae26766864247d4a4ca'
});
