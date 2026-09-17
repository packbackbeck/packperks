import packperksLogo from '../../../assets/images/packperks-logo.svg';
import PulseCanvas from './PulseCanvas';
import ProductShowcase from './ProductShowcase';
import '../../ui/ui.css';
import '../LoginPage.css';

/* The two-column frame of the admin sign-in and reset-password screens.
 * Left: logo, the form (children) centred, footer. Right, from 1024px up: a
 * violet night with the pulse animation, a headline and the product
 * showcase. The right panel is decoration only, so it is hidden from
 * assistive tech. `.pp-login` also carries the admin design tokens. */
export default function AuthLayout({ children }) {
  return (
    <div className="pp-login">
      <div className="pp-login__grid">
        <div className="pp-login__main">
          <header className="pp-login__brand">
            <img
              src={packperksLogo}
              alt="PackPerks"
              className="pp-login__logo"
              width="148"
              height="32"
            />
            <span className="pp-login__tag">Admin</span>
          </header>

          <main className="pp-login__center">
            <div className="pp-login__panel">{children}</div>
          </main>

          <p className="pp-login__foot">PackBack · PackPerks</p>
        </div>

        <aside className="pp-login__aside" aria-hidden="true">
          <div className="pp-login__glow" />
          <PulseCanvas className="pp-login__canvas" />
          <div className="pp-login__fade" />
          <div className="pp-login__content">
            <div className="pp-login__copy">
              <p className="pp-login__headline">
                Every cup back, every reward <span className="pp-login__accent">earned.</span>
              </p>
              <p className="pp-login__lede">
                See cups returned, rewards claimed and cashback paid out for every
                venue, in one place. Review claims, update rewards and watch the
                impact add up.
              </p>
            </div>
            <div className="pp-login__stage">
              <ProductShowcase />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
