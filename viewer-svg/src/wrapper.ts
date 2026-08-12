// Import vue component
import launch from './launch';

if (typeof window !== 'undefined') {
  (window as any).take6 = { launch };
}

export default launch;
