type LoginBtnProps = {
  redirectTo?: string;
  class?: string;
};

/** Link styled as a button that navigates to the login page. */
export default function LoginBtn(props: LoginBtnProps) {
  const href = props.redirectTo ? `/auth/login?redirectTo=${encodeURIComponent(props.redirectTo)}` : "/auth/login";

  return (
    <a href={href} class={props.class ?? "btn-primary"}>
      <i class="ti ti-login" />
      <span>Sign In</span>
    </a>
  );
}
