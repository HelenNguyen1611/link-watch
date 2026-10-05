"use client";

import { Role, UserInvite, type UserView } from "@linkwatch/core";
import {
	Alert,
	Badge,
	Button,
	Group,
	Loader,
	Modal,
	Select,
	Stack,
	Switch,
	Table,
	Text,
	TextInput,
	Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { IconPlus, IconTrash } from "@/components/icons";
import { PageHeader } from "@/components/PageHeader";
import { ApiError } from "@/lib/api";
import { useApi } from "@/lib/api-context";
import { useAuth, useCan } from "@/lib/auth-context";
import { PALETTE } from "@/lib/colors";
import { formatDateTime } from "@/lib/format";

const USERS_KEY = ["users"] as const;

/** i18n key under users.errors for an API error (409 codes from the API, FR-29). */
function errorKey(err: unknown): string {
	if (err instanceof ApiError) {
		const code = err.body.error;
		if (
			code === "duplicate" ||
			code === "self_change" ||
			code === "last_admin" ||
			code === "not_invited" ||
			code === "not_active" ||
			code === "disabled" ||
			code === "forbidden"
		)
			return code;
	}
	return "failed";
}

function useUserMutation<T>(fn: (input: T) => Promise<unknown>, done: string) {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: fn,
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: USERS_KEY });
			notifications.show({ color: PALETTE.success, message: t(done) });
		},
		onError: (err) =>
			notifications.show({
				color: PALETTE.danger,
				message: t(`users.errors.${errorKey(err)}`),
			}),
	});
}

function InviteDialog({
	opened,
	onClose,
}: {
	opened: boolean;
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const [email, setEmail] = useState("");
	const [role, setRole] = useState<Role>("viewer");
	const [error, setError] = useState<string | undefined>();
	const close = () => {
		setEmail("");
		setRole("viewer");
		setError(undefined);
		onClose();
	};
	const invite = useMutation({
		mutationFn: (input: UserInvite) => api.inviteUser(input),
		onSuccess: (user) => {
			void queryClient.invalidateQueries({ queryKey: USERS_KEY });
			notifications.show({
				color: PALETTE.success,
				message: t("users.invited", { email: user.email }),
			});
			close();
		},
		onError: (err) => setError(t(`users.errors.${errorKey(err)}`)),
	});
	const submit = (e: React.FormEvent) => {
		e.preventDefault();
		const parsed = UserInvite.safeParse({ email, role });
		if (!parsed.success) {
			setError(t("users.errors.email"));
			return;
		}
		setError(undefined);
		invite.mutate(parsed.data);
	};
	return (
		<Modal opened={opened} onClose={close} title={t("users.inviteTitle")}>
			<form onSubmit={submit} noValidate>
				<Stack gap="md">
					<Text size="sm" c="dimmed">
						{t("users.inviteHint")}
					</Text>
					<TextInput
						label={t("users.email")}
						type="email"
						value={email}
						onChange={(e) => setEmail(e.currentTarget.value)}
						error={error}
						required
						data-autofocus
					/>
					<RoleSelect value={role} onChange={setRole} />
					<Group justify="flex-end">
						<Button variant="subtle" color="gray" onClick={close}>
							{t("users.cancel")}
						</Button>
						<Button type="submit" loading={invite.isPending}>
							{t("users.sendInvite")}
						</Button>
					</Group>
				</Stack>
			</form>
		</Modal>
	);
}

function RoleSelect({
	value,
	onChange,
	disabled,
	label,
}: {
	value: Role;
	onChange: (role: Role) => void;
	disabled?: boolean;
	label?: string;
}) {
	const { t } = useTranslation();
	return (
		<Select
			label={label === undefined ? t("users.role") : undefined}
			aria-label={label}
			data={Role.options.map((r) => ({
				value: r,
				label: t(`users.roles.${r}`),
			}))}
			description={
				label === undefined ? t(`users.roleHint.${value}`) : undefined
			}
			value={value}
			onChange={(v) => {
				const parsed = Role.safeParse(v);
				if (parsed.success) onChange(parsed.data);
			}}
			allowDeselect={false}
			disabled={disabled}
			size={label === undefined ? "sm" : "xs"}
			w={label === undefined ? undefined : 120}
		/>
	);
}

function DeleteUser({ user }: { user: UserView }) {
	const { t } = useTranslation();
	const api = useApi();
	const [confirming, setConfirming] = useState(false);
	const remove = useUserMutation(
		() => api.deleteUser(user.email),
		"users.deleted",
	);
	return (
		<Button
			size="xs"
			variant={confirming ? "filled" : "subtle"}
			color={PALETTE.danger}
			leftSection={<IconTrash size={14} />}
			loading={remove.isPending}
			onClick={() =>
				confirming
					? remove.mutate(undefined, { onSettled: () => setConfirming(false) })
					: setConfirming(true)
			}
			onBlur={() => setConfirming(false)}
			aria-label={`${t(confirming ? "users.confirmDelete" : "users.delete")} ${user.email}`}
		>
			{t(confirming ? "users.confirmDelete" : "users.delete")}
		</Button>
	);
}

/** FR-20: every alert to this user; only an active, enabled account can be switched on. */
function AlertsSwitch({ user }: { user: UserView }) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const toggle = useMutation({
		mutationFn: (on: boolean) => api.setUserAlerts(user.email, on),
		onSuccess: (res) => {
			void queryClient.invalidateQueries({ queryKey: USERS_KEY });
			void queryClient.invalidateQueries({ queryKey: ["settings"] });
			notifications.show({
				color: PALETTE.success,
				message: t(res.alerts ? "users.alerts.on" : "users.alerts.off", {
					email: user.email,
				}),
			});
		},
		onError: (err) =>
			notifications.show({
				color: PALETTE.danger,
				message: t(`users.errors.${errorKey(err)}`),
			}),
	});
	const allowed = user.enabled && user.status === "active";
	const control = (
		<Switch
			size="sm"
			checked={user.alerts}
			// Switching off stays possible, e.g. for an account disabled meanwhile.
			disabled={toggle.isPending || (!allowed && !user.alerts)}
			onChange={(e) => toggle.mutate(e.currentTarget.checked)}
			aria-label={t("users.alerts.label", { email: user.email })}
		/>
	);
	return allowed || user.alerts ? (
		control
	) : (
		<Tooltip label={t("users.alerts.onlyActive")} withArrow>
			<span>{control}</span>
		</Tooltip>
	);
}

function UserRow({ user, isSelf }: { user: UserView; isSelf: boolean }) {
	const { t } = useTranslation();
	const api = useApi();
	const update = useUserMutation(
		(input: { role?: Role; enabled?: boolean }) =>
			api.updateUser(user.email, input),
		"users.saved",
	);
	const resend = useUserMutation(
		() => api.resendInvite(user.email),
		"users.resent",
	);
	return (
		<Table.Tr>
			<Table.Td>
				<Group gap="xs">
					<Text size="sm" fw={500}>
						{user.email}
					</Text>
					{isSelf && (
						<Badge size="xs" variant="light">
							{t("users.you")}
						</Badge>
					)}
				</Group>
			</Table.Td>
			<Table.Td>
				<RoleSelect
					value={user.role}
					onChange={(role) => update.mutate({ role })}
					disabled={isSelf || update.isPending}
					label={`${t("users.role")} ${user.email}`}
				/>
			</Table.Td>
			<Table.Td>
				<Badge
					size="sm"
					variant="light"
					color={
						!user.enabled
							? "gray"
							: user.status === "invited"
								? "yellow"
								: PALETTE.success
					}
				>
					{t(
						user.enabled
							? `users.status.${user.status}`
							: "users.status.disabled",
					)}
				</Badge>
			</Table.Td>
			<Table.Td>
				<AlertsSwitch user={user} />
			</Table.Td>
			<Table.Td>
				<Text size="sm" c="dimmed">
					{user.createdAt ? formatDateTime(user.createdAt) : "—"}
				</Text>
			</Table.Td>
			<Table.Td>
				<Group gap={4} wrap="nowrap" justify="flex-end">
					{user.enabled && user.status === "invited" && (
						<Button
							size="xs"
							variant="subtle"
							loading={resend.isPending}
							onClick={() => resend.mutate(undefined)}
							aria-label={`${t("users.resend")} ${user.email}`}
						>
							{t("users.resend")}
						</Button>
					)}
					{!isSelf && (
						<Button
							size="xs"
							variant="subtle"
							color={user.enabled ? "gray" : undefined}
							loading={update.isPending}
							onClick={() => update.mutate({ enabled: !user.enabled })}
							aria-label={`${t(user.enabled ? "users.disable" : "users.enable")} ${user.email}`}
						>
							{t(user.enabled ? "users.disable" : "users.enable")}
						</Button>
					)}
					{!isSelf && <DeleteUser user={user} />}
				</Group>
			</Table.Td>
		</Table.Tr>
	);
}

/** SCR-09 / FR-29: invite users, change their role, disable or delete them (admin only). */
export function UsersPage() {
	const { t } = useTranslation();
	const api = useApi();
	const { user: me } = useAuth();
	const allowed = useCan()("manage_users");
	const [inviting, setInviting] = useState(false);
	const query = useQuery({
		queryKey: USERS_KEY,
		queryFn: () => api.listUsers(),
		enabled: allowed,
	});

	return (
		<>
			<PageHeader
				title={t("nav.settingsUsers")}
				description={t("users.subtitle")}
				action={
					allowed && (
						<Button
							variant="light"
							leftSection={<IconPlus size={18} />}
							onClick={() => setInviting(true)}
						>
							{t("users.invite")}
						</Button>
					)
				}
				mb={24}
			/>
			{!allowed ? (
				<Alert color="gray" variant="light">
					{t("users.adminOnly")}
				</Alert>
			) : query.isPending ? (
				<Loader />
			) : query.isError ? (
				<Alert color={PALETTE.danger} variant="light">
					{t("users.loadError")}
				</Alert>
			) : (
				<Table.ScrollContainer minWidth={720}>
					<Table verticalSpacing="sm" borderColor="gray.2" highlightOnHover>
						<Table.Thead>
							<Table.Tr>
								{["email", "role", "status", "alerts", "created"].map((k) => (
									<Table.Th key={k} c="dimmed" fz="xs" fw={400}>
										{t(`users.col.${k}`)}
									</Table.Th>
								))}
								<Table.Th />
							</Table.Tr>
						</Table.Thead>
						<Table.Tbody>
							{query.data.items.map((u) => (
								<UserRow
									key={u.email}
									user={u}
									isSelf={u.email === me?.email.toLowerCase()}
								/>
							))}
						</Table.Tbody>
					</Table>
				</Table.ScrollContainer>
			)}
			<Text size="xs" c="dimmed" mt="md">
				{t("users.alerts.note")}
			</Text>
			<Text size="xs" c="dimmed" mt={4}>
				{t("users.signOutNote")}
			</Text>
			<InviteDialog opened={inviting} onClose={() => setInviting(false)} />
		</>
	);
}
